/**
 * OpenAI Responses API loop — uses `POST /v1/responses` (not Chat Completions).
 *
 * Key difference from the chat-completions loop: remote MCP servers are passed
 * as `{ type: "mcp" }` tool entries with OAuth bearer tokens.  OpenAI processes
 * those tool calls server-side — we never see the individual tool calls.
 * Local function tools still go through our own executeTool() dispatcher.
 *
 * Used when:
 *   - provider === 'openai'
 *   - at least one enabled McpServerConfig has serverType === 'remote'
 *     AND a valid oauthToken
 */

import OpenAI from 'openai'
import {
  AppSettings,
  McpServerConfig,
  MessageRole,
  ImageAttachment,
  supportsReasoningDepth,
} from '../shared/types'
import { executeTool, getCustomPlugins, DiffApprovalFn } from './tools'
import { isTokenValid } from './mcp-oauth'
import { log } from './logger'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ResponsesAgentCallbacks {
  onTextChunk:       (text: string) => void
  onToolCallStart:   (callId: string, name: string, input: Record<string, unknown>) => void
  onToolCallResult:  (callId: string, output: string, isError: boolean) => void
  onToolOutputChunk: (callId: string, chunk: string) => void
  onDiffRequest:     DiffApprovalFn | undefined
  abortSignal:       AbortSignal
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the MCP tool entry for a remote server that has a valid OAuth token. */
function buildMcpTool(server: McpServerConfig): Record<string, unknown> | null {
  if (!server.serverUrl || !server.oauthToken) return null
  if (!isTokenValid(server.oauthToken.expiresAt)) return null
  return {
    type:         'mcp',
    server_label: server.name.replace(/\s+/g, '_').toLowerCase(),
    server_url:   server.serverUrl,
    headers:      { Authorization: `Bearer ${server.oauthToken.accessToken}` },
    require_approval: server.requireApproval ? 'always' : 'never',
  }
}

// ── Responses-API input message types (not exported by openai SDK yet) ────────

type RespMessage =
  | { role: 'user';      content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | { role: 'assistant'; content: string }
  | { role: 'system';    content: string }
  | { role: 'tool';      tool_call_id: string; content: string }

// Local tool definitions (same as the Chat-Completions loop but trimmed) ──────

const LOCAL_TOOLS: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file with line numbers.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file_range',
      description: 'Read a specific range of lines from a file.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string' },
          start_line: { type: 'number' },
          end_line:   { type: 'number' },
        },
        required: ['path', 'start_line', 'end_line']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'str_replace',
      description: 'Make a surgical edit by replacing an exact unique string in a file.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string' },
          old_str: { type: 'string' },
          new_str: { type: 'string' },
        },
        required: ['path', 'old_str', 'new_str']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write the complete content of a file, creating it if it does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and subdirectories in a directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a regex pattern across workspace files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path:    { type: 'string' },
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the workspace directory.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch the content of a URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }
    }
  },
]

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runOpenAIResponsesLoop(
  messages: { role: MessageRole; content: string; images?: ImageAttachment[] }[],
  settings: AppSettings,
  remoteMcpServers: McpServerConfig[],
  callbacks: ResponsesAgentCallbacks,
): Promise<string> {

  // Build the Responses-API client via the openai SDK's beta namespace
  const client = new OpenAI({
    apiKey:  settings.apiKey,
    baseURL: 'https://api.openai.com/v1',   // Responses API only on official endpoint
  })

  // Convert messages to Responses API format
  let history: RespMessage[] = []

  if (settings.systemPrompt?.trim()) {
    history.push({ role: 'system', content: settings.systemPrompt.trim() })
  }

  for (const m of messages) {
    if (m.role === 'system') {
      // Already prepended above — skip duplicates from history
      continue
    }
    if (m.role === 'user' && m.images && m.images.length > 0) {
      const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
        ...m.images.map(img => ({
          type:      'image_url' as const,
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        })),
        ...(m.content.trim() ? [{ type: 'text' as const, text: m.content }] : []),
      ]
      history.push({ role: 'user', content: parts })
    } else {
      history.push({ role: m.role as 'user' | 'assistant', content: m.content })
    }
  }

  // Build tool list: local function tools + remote MCP tools
  const mcpTools = remoteMcpServers
    .filter(s => s.enabled && s.serverType === 'remote')
    .map(buildMcpTool)
    .filter((t): t is Record<string, unknown> => t !== null)

  const customPluginTools = getCustomPlugins().map(p => ({
    type: 'function' as const,
    function: {
      name:        p.name,
      description: p.description,
      parameters:  { type: 'object', properties: p.parameters, required: [] },
    }
  }))

  const allTools: unknown[] = [
    ...(settings.workspacePath ? LOCAL_TOOLS : LOCAL_TOOLS.filter(t =>
      !['read_file','read_file_range','str_replace','write_file','list_directory','search_files','run_command'].includes(t.function.name)
    )),
    ...customPluginTools,
    ...mcpTools,
  ]

  let fullText = ''
  const maxIter = Math.max(1, settings.maxIterations ?? 50)

  for (let iteration = 0; iteration < maxIter; iteration++) {
    if (callbacks.abortSignal.aborted) break

    const isOSeries     = supportsReasoningDepth('openai', settings.model)
    const reasoningEffort = (settings.reasoningDepth && settings.reasoningDepth !== 'off' && isOSeries)
      ? settings.reasoningDepth
      : undefined

    // Use the raw fetch approach since the SDK's responses.create() may not
    // support all params yet.  We cast `client` to access the private _client.
    const reqBody: Record<string, unknown> = {
      model:      settings.model,
      max_output_tokens: settings.maxTokens,
      tools:      allTools,
      input:      history,
      stream:     true,
      ...(reasoningEffort
        ? { reasoning: { effort: reasoningEffort } }
        : {
            ...(settings.temperature !== undefined && { temperature: settings.temperature }),
            ...(settings.topP        !== undefined && { top_p:       settings.topP }),
          }
      ),
    }

    log.info('openai-responses-loop', `iteration ${iteration}`, {
      messageCount: history.length,
      toolCount:    allTools.length,
      mcpCount:     mcpTools.length,
    })

    // Use the openai SDK's internal fetch helper for SSE
    const response = await (client as unknown as {
      _client: { fetch: (url: string, opts: RequestInit) => Promise<Response> }
    })._client.fetch('https://api.openai.com/v1/responses', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
        'Accept':        'text/event-stream',
      },
      body:   JSON.stringify(reqBody),
      signal: callbacks.abortSignal,
    })

    if (!response.ok) {
      const text = await response.text()
      log.error('openai-responses-loop', 'API error', { status: response.status, body: text.slice(0, 300) })
      throw new Error(`OpenAI Responses API error ${response.status}: ${text.slice(0, 200)}`)
    }

    // Parse SSE stream
    const reader   = response.body!.getReader()
    const decoder  = new TextDecoder()
    let   buffer   = ''

    // Accumulate function tool calls (indexed by call ID)
    const localCallAccum = new Map<string, { name: string; argsJson: string }>()
    let assistantText  = ''
    let finishReason: string | null = null

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (callbacks.abortSignal.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') { finishReason = 'done'; break }

        let event: Record<string, unknown>
        try { event = JSON.parse(data) } catch { continue }

        const type = event.type as string | undefined

        // Text delta
        if (type === 'response.output_text.delta') {
          const delta = (event.delta as string) ?? ''
          callbacks.onTextChunk(delta)
          assistantText += delta
          fullText      += delta
        }

        // Function tool call delta (local tools)
        if (type === 'response.function_call_arguments.delta') {
          const callId = event.call_id as string
          const delta  = (event.delta as string) ?? ''
          if (!localCallAccum.has(callId)) {
            localCallAccum.set(callId, { name: '', argsJson: '' })
          }
          localCallAccum.get(callId)!.argsJson += delta
        }

        // Function call name established
        if (type === 'response.output_item.added') {
          const item = event.item as Record<string, unknown> | undefined
          if (item?.type === 'function_call') {
            const callId = item.call_id as string
            const name   = item.name as string
            if (!localCallAccum.has(callId)) {
              localCallAccum.set(callId, { name, argsJson: '' })
            } else {
              localCallAccum.get(callId)!.name = name
            }
          }
        }

        // Done signal
        if (type === 'response.done') {
          finishReason = 'done'
          const respObj = event.response as Record<string, unknown> | undefined
          if (respObj?.status === 'completed') finishReason = 'stop'
        }
      }
    }

    if (callbacks.abortSignal.aborted) break

    // Filter to only local function calls (MCP handled server-side)
    const localCalls = [...localCallAccum.entries()].filter(([, v]) => v.name)

    if (localCalls.length === 0) {
      // No local tool calls — done
      break
    }

    // ── Execute local tools ───────────────────────────────────────────────────
    // Append assistant turn (with text + function_call items)
    const assistantOutputItems: unknown[] = []
    if (assistantText.trim()) {
      assistantOutputItems.push({ type: 'text', text: assistantText })
    }
    for (const [callId, call] of localCalls) {
      assistantOutputItems.push({
        type: 'function_call',
        id:   callId,
        name: call.name,
        arguments: call.argsJson,
      })
    }
    // Responses API: assistant turn is an array of output items
    history.push({ role: 'assistant', content: assistantText } as RespMessage)

    // Execute each local tool and gather results
    const toolResults: Array<{ callId: string; output: string; isError: boolean }> = []

    for (const [callId, call] of localCalls) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(call.argsJson || '{}') } catch { /* use empty */ }

      callbacks.onToolCallStart(callId, call.name, input)

      const result = await executeTool(
        call.name, input,
        settings.workspacePath ?? '',
        callbacks.onDiffRequest,
        callbacks.onToolOutputChunk ? (chunk: string) => callbacks.onToolOutputChunk(callId, chunk) : undefined,
        undefined,
      )

      callbacks.onToolCallResult(callId, result.output, result.isError)
      toolResults.push({ callId, output: result.output, isError: result.isError })

      // Add tool result as a function_call_output message
      history.push({
        role:         'tool',
        tool_call_id: callId,
        content:      result.output,
      } as RespMessage)
    }
  }

  return fullText
}

/** Returns true when at least one enabled remote MCP server has a valid token. */
export function hasValidRemoteMcp(mcpServers: McpServerConfig[]): boolean {
  return mcpServers.some(s =>
    s.enabled &&
    s.serverType === 'remote' &&
    s.serverUrl &&
    s.oauthToken &&
    isTokenValid(s.oauthToken.expiresAt)
  )
}
