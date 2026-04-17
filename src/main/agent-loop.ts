/**
 * Agent loop for Anthropic Claude with tool use.
 *
 * Flow per iteration:
 *   1. Stream message to AI (with tool definitions)
 *   2. As text chunks arrive → onTextChunk()
 *   3. Collect tool_use blocks while streaming
 *   4. After stream ends:
 *      - If stop_reason === 'end_turn' → done
 *      - If stop_reason === 'tool_use':
 *          a. For each tool call: onToolCallStart() → executeTool() → onToolCallResult()
 *          b. Append assistant message + tool results to history
 *          c. Loop back to step 1
 *
 * Max iterations prevents runaway loops (default: 10).
 */

import Anthropic from '@anthropic-ai/sdk'
import { AppSettings, MessageRole, ImageAttachment, supportsReasoningDepth } from '../shared/types'
import { ANTHROPIC_TOOLS, getCustomToolDefinitions, executeTool, runAutoValidator, DiffApprovalFn } from './tools'
import { getActiveMcpTools, callMcpTool } from './mcp-client'

/** Convert active MCP servers' tools into Anthropic tool definitions. */
function getMcpToolsForAnthropic(): Anthropic.Messages.Tool[] {
  return getActiveMcpTools().map(({ serverId, tool }) => ({
    name:         `mcp__${serverId}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
    description:  `[MCP] ${tool.description}`,
    input_schema: (tool.inputSchema as Anthropic.Messages.Tool['input_schema']) ?? { type: 'object', properties: {}, required: [] }
  }))
}

const MAX_ITERATIONS = 10   // fallback only — overridden by settings.maxIterations

// ── Callback surface (main process → ipc-handlers) ────────────────────────────

export interface AgentCallbacks {
  onTextChunk:       (text: string) => void
  onToolCallStart:   (callId: string, name: string, input: Record<string, unknown>) => void
  onToolCallResult:  (callId: string, output: string, isError: boolean) => void
  onToolOutputChunk: (callId: string, chunk: string) => void
  onDiffRequest:     DiffApprovalFn
  abortSignal:       AbortSignal
}

// ── Message types used in the loop ───────────────────────────────────────────

type AnthropicMessage = Anthropic.MessageParam

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runAnthropicAgentLoop(
  messages: { role: MessageRole; content: string; images?: ImageAttachment[] }[],
  settings: AppSettings,
  callbacks: AgentCallbacks
): Promise<string> {
  // Determine if extended thinking is requested for this model
  const thinkingDepth = settings.reasoningDepth
  const useThinking = thinkingDepth && thinkingDepth !== 'off'
    && supportsReasoningDepth('anthropic', settings.model)

  const THINKING_BUDGET: Record<string, number> = {
    low:    1024,
    medium: 8000,
    high:   16000
  }
  const thinkingBudget = useThinking ? (THINKING_BUDGET[thinkingDepth!] ?? 8000) : 0

  const client = new Anthropic({
    apiKey: settings.apiKey,
    baseURL:
      settings.baseUrl && settings.baseUrl !== 'https://api.anthropic.com'
        ? settings.baseUrl
        : undefined,
    defaultHeaders: {
      'anthropic-beta': useThinking
        ? 'interleaved-thinking-2025-05-14'
        : 'prompt-caching-2024-07-31'
    }
  })

  // Separate system message from conversation history
  const systemMessage = messages.find(m => m.role === 'system')
  const systemText = systemMessage?.content ?? settings.systemPrompt

  // ── System with cache_control — cache the system prompt (stable across turns) ─
  const systemWithCache: Anthropic.TextBlockParam[] = [{
    type:          'text',
    text:          systemText,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cache_control: { type: 'ephemeral' } as any
  }]

  // Build mutable conversation history (tool_result messages use Anthropic's complex format)
  let history: AnthropicMessage[] = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      // Build multi-part content when the user message has image attachments
      if (m.role === 'user' && m.images && m.images.length > 0) {
        const parts: Anthropic.MessageParam['content'] = [
          ...m.images.map(img => ({
            type:   'image' as const,
            source: {
              type:       'base64' as const,
              media_type: img.mimeType as Anthropic.Base64ImageSource['media_type'],
              data:       img.data
            }
          })),
          ...(m.content.trim() ? [{ type: 'text' as const, text: m.content }] : [])
        ]
        return { role: 'user' as const, content: parts }
      }
      return {
        role:    m.role as 'user' | 'assistant',
        content: m.content
      }
    })

  let fullText = ''
  let consecutiveErrors = 0
  const MAX_CONSECUTIVE_ERRORS = 3
  const maxIter = Math.max(1, settings.maxIterations ?? MAX_ITERATIONS)

  for (let iteration = 0; iteration < maxIter; iteration++) {
    if (callbacks.abortSignal.aborted) break

    // ── Build history with cache breakpoint on the conversation prefix ──────
    // Mark the second-to-last message (last assistant turn before current user
    // message) so Anthropic caches everything up to that point.
    let cachedHistory = history
    if (history.length >= 2) {
      const prefixIdx = history.length - 2
      const prefixMsg = history[prefixIdx]
      let newContent: Anthropic.MessageParam['content']
      if (typeof prefixMsg.content === 'string') {
        newContent = [{ type: 'text', text: prefixMsg.content, cache_control: { type: 'ephemeral' } } as Anthropic.TextBlockParam]
      } else if (Array.isArray(prefixMsg.content) && prefixMsg.content.length > 0) {
        const blocks = [...prefixMsg.content] as (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
        const last = blocks[blocks.length - 1]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks[blocks.length - 1] = { ...last, cache_control: { type: 'ephemeral' } } as any
        newContent = blocks
      } else {
        newContent = prefixMsg.content
      }
      cachedHistory = [
        ...history.slice(0, prefixIdx),
        { ...prefixMsg, content: newContent },
        ...history.slice(prefixIdx + 1)
      ]
    }

    // ── Stream this turn ────────────────────────────────────────────────────
    const stream = client.messages.stream({
      model:      settings.model,
      max_tokens: settings.maxTokens,
      ...(settings.temperature !== undefined && !useThinking && { temperature: settings.temperature }),
      ...(settings.topP        !== undefined && !useThinking && { top_p:       settings.topP }),
      // Extended thinking — temperature must be 1 when enabled (Anthropic requirement)
      ...(useThinking && { temperature: 1 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(useThinking && { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      system:     systemWithCache as any,
      tools:      [...ANTHROPIC_TOOLS, ...getCustomToolDefinitions(), ...getMcpToolsForAnthropic()],
      messages:   cachedHistory
    })

    // Collect tool_use input JSON as it streams in
    const pendingTools = new Map<number, { id: string; name: string; inputJson: string }>()

    for await (const event of stream) {
      if (callbacks.abortSignal.aborted) break

      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        pendingTools.set(event.index, {
          id:        event.content_block.id,
          name:      event.content_block.name,
          inputJson: ''
        })
      }

      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          callbacks.onTextChunk(event.delta.text)
          fullText += event.delta.text
        }
        // thinking_delta — silently consume, don't stream to chat
        if ((event.delta as { type: string }).type === 'thinking_delta') {
          // extended thinking tokens — intentionally not forwarded to UI
        }
        if (event.delta.type === 'input_json_delta') {
          const block = pendingTools.get(event.index)
          if (block) block.inputJson += event.delta.partial_json
        }
      }
    }

    if (callbacks.abortSignal.aborted) break

    // ── Get final message (includes full content blocks) ────────────────────
    const finalMsg = await stream.finalMessage()

    // ── Check if there are any tool calls ──────────────────────────────────
    const toolUseBlocks = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    if (toolUseBlocks.length === 0 || finalMsg.stop_reason === 'end_turn') {
      // No more tool calls — we're done
      break
    }

    // ── Execute each tool ───────────────────────────────────────────────────
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    let thisIterationHadError = false

    for (const toolBlock of toolUseBlocks) {
      if (callbacks.abortSignal.aborted) break

      const input = toolBlock.input as Record<string, unknown>

      callbacks.onToolCallStart(toolBlock.id, toolBlock.name, input)

      // Route MCP tools to callMcpTool; everything else to executeTool
      let result: { output: string; isError: boolean }
      if (toolBlock.name.startsWith('mcp__')) {
        const [, serverId, ...toolParts] = toolBlock.name.split('__')
        const toolName = toolParts.join('__')
        const mcpResult = await callMcpTool(serverId, toolName, input)
        result = { output: mcpResult.ok ? mcpResult.output : (mcpResult.error ?? 'MCP tool error'), isError: !mcpResult.ok }
      } else {
        result = await executeTool(
          toolBlock.name, input, settings.workspacePath, callbacks.onDiffRequest,
          (chunk) => callbacks.onToolOutputChunk(toolBlock.id, chunk),
          settings.braveApiKey
        )
      }

      // ── Verify-after-write: auto-read the file back after str_replace/write_file ─
      // This lets the model see exactly what landed on disk and catch any mistakes.
      let verifiedOutput = result.output
      if (!result.isError && (toolBlock.name === 'str_replace' || toolBlock.name === 'write_file')) {
        const filePath = input.path as string
        if (filePath) {
          const verify = await executeTool('read_file', { path: filePath }, settings.workspacePath, undefined, undefined, settings.braveApiKey)
          if (!verify.isError) {
            verifiedOutput = result.output + '\n\n[File after edit:]\n' + verify.output
          }
        }
        // ── Auto-validate: run type-checker and append any errors ──────────
        const validationError = await runAutoValidator(settings.workspacePath)
        if (validationError) verifiedOutput += validationError
      }

      if (result.isError) thisIterationHadError = true

      callbacks.onToolCallResult(toolBlock.id, verifiedOutput, result.isError)

      // If a tool errored, add a self-correction hint so the model understands what happened
      const toolResultContent = result.isError
        ? `ERROR: ${verifiedOutput}\n\nPlease re-read the relevant file, understand the current state, and try a different approach.`
        : verifiedOutput

      toolResults.push({
        type:        'tool_result',
        tool_use_id: toolBlock.id,
        content:     toolResultContent,
        is_error:    result.isError
      })
    }

    if (toolResults.length === 0) break  // aborted

    // Track consecutive errors to bail out of infinite retry loops
    if (thisIterationHadError) {
      consecutiveErrors++
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        // Inject a message telling the model to stop retrying and explain the problem
        history = [
          ...history,
          { role: 'assistant', content: finalMsg.content },
          {
            role: 'user', content: [
              ...toolResults,
              {
                type: 'tool_result' as const,
                tool_use_id: toolUseBlocks[toolUseBlocks.length - 1]?.id ?? 'stop',
                content: `You have encountered ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors. Stop retrying. Explain to the user what went wrong and what they should do to fix it.`
              }
            ]
          }
        ]
        break
      }
    } else {
      consecutiveErrors = 0
    }

    // ── Append assistant turn + tool results, then loop ─────────────────────
    history = [
      ...history,
      { role: 'assistant', content: finalMsg.content },
      { role: 'user',      content: toolResults }
    ]
  }

  return fullText
}
