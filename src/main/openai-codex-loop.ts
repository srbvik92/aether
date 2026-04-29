/**
 * OpenAI Codex agent loop — uses the ChatGPT subscription endpoint
 * (chatgpt.com/backend-api/codex/responses) so requests draw from the
 * user's ChatGPT Plus/Pro quota rather than pay-per-token API credits.
 *
 * Request format reverse-engineered from openai/codex (codex-rs source):
 *   - codex-rs/codex-client/src/request.rs    (headers)
 *   - codex-rs/model-provider/src/bearer_auth_provider.rs  (auth headers)
 *   - codex-rs/codex-api/src/common.rs        (body schema)
 *   - codex-rs/core/src/client.rs             (per-turn headers)
 */

import { randomUUID }  from 'crypto'
import { net }         from 'electron'
import { AppSettings, MessageRole, ImageAttachment, supportsReasoningDepth } from '../shared/types'
import { executeTool, getCustomPlugins, DiffApprovalFn } from './tools'
import { log } from './logger'

// Inlined to avoid circular-import / bundling issues with openai-auth
const CHATGPT_CODEX_BASE = 'https://chatgpt.com/backend-api/codex'

export interface CodexAgentCallbacks {
  onTextChunk:       (text: string) => void
  onToolCallStart:   (callId: string, name: string, input: Record<string, unknown>) => void
  onToolCallResult:  (callId: string, output: string, isError: boolean) => void
  onToolOutputChunk: (callId: string, chunk: string) => void
  onDiffRequest:     DiffApprovalFn | undefined
  abortSignal:       AbortSignal
}

// Stable per-session installation ID (mimics `x-codex-installation-id`)
const INSTALLATION_ID = randomUUID()

// ── Local tool definitions (Responses API flat format) ───────────────────────
// The Responses API expects { type, name, description, parameters } at the top
// level — NOT the Chat Completions nested { type, function: { name, ... } }.

const LOCAL_TOOLS = [
  { type: 'function' as const, name: 'read_file',       description: 'Read a file with line numbers.',                     parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { type: 'function' as const, name: 'read_file_range', description: 'Read a specific range of lines from a file.',        parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['path', 'start_line', 'end_line'] } },
  { type: 'function' as const, name: 'str_replace',     description: 'Surgical edit — replace unique text in a file.',     parameters: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] } },
  { type: 'function' as const, name: 'write_file',      description: 'Write or overwrite a file.',                        parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { type: 'function' as const, name: 'list_directory',  description: 'List files and subdirectories.',                    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { type: 'function' as const, name: 'search_files',    description: 'Search for a regex pattern across workspace files.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
  { type: 'function' as const, name: 'run_command',     description: 'Run a shell command in the workspace directory.',   parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { type: 'function' as const, name: 'web_search',      description: 'Search the web for current information.',           parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { type: 'function' as const, name: 'fetch_url',       description: 'Fetch the content of a URL.',                      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
]

// ── Responses API input item types ────────────────────────────────────────────
// The Responses API uses different content-type names from Chat Completions:
//   user content:      'input_text' | 'input_image'
//   assistant content: 'output_text'
// Function calls are TOP-LEVEL items in the input array — NOT nested in content.

type InputTextItem  = { type: 'input_text';  text: string }
type InputImageItem = { type: 'input_image'; image_url: string }
type OutputTextItem = { type: 'output_text'; text: string }
type FuncCallItem   = { type: 'function_call'; id: string; call_id: string; name: string; arguments: string }
type FuncOutputItem = { type: 'function_call_output'; call_id: string; output: string }
type UserMsg        = { role: 'user';      content: string | Array<InputTextItem | InputImageItem> }
type AssistantMsg   = { role: 'assistant'; content: string | Array<OutputTextItem> }

type InputItem = UserMsg | AssistantMsg | FuncCallItem | FuncOutputItem

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runOpenAICodexLoop(
  messages:       { role: MessageRole; content: string; images?: ImageAttachment[] }[],
  settings:       AppSettings,
  accessToken:    string,
  accountId:      string | undefined,
  conversationId: string,
  callbacks:      CodexAgentCallbacks,
): Promise<string> {

  // Build initial input array (no system message in input — goes in `instructions`)
  const history: InputItem[] = []

  for (const m of messages) {
    if (m.role === 'system') continue   // handled via `instructions` field
    if (m.role === 'user' && m.images && m.images.length > 0) {
      const parts: Array<InputTextItem | InputImageItem> = [
        ...m.images.map(img => ({
          type:      'input_image' as const,
          image_url: `data:${img.mimeType};base64,${img.data}`,
        })),
        ...(m.content.trim() ? [{ type: 'input_text' as const, text: m.content }] : []),
      ]
      history.push({ role: 'user', content: parts })
    } else if (m.role === 'user') {
      history.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      history.push({ role: 'assistant', content: m.content })
    }
  }

  const isOSeries       = supportsReasoningDepth('openai', settings.model)
  const reasoningEffort = (settings.reasoningDepth && settings.reasoningDepth !== 'off' && isOSeries)
    ? settings.reasoningDepth
    : undefined

  const customPluginTools = getCustomPlugins().map(p => ({
    type:        'function' as const,
    name:        p.name,
    description: p.description,
    parameters:  { type: 'object', properties: p.parameters, required: [] },
  }))

  const allTools = [
    ...(settings.workspacePath ? LOCAL_TOOLS : LOCAL_TOOLS.filter(t =>
      !['read_file','read_file_range','str_replace','write_file','list_directory','search_files','run_command'].includes(t.name)
    )),
    ...customPluginTools,
  ]

  // ── Build required headers ────────────────────────────────────────────────

  const baseHeaders: Record<string, string> = {
    'Content-Type':  'application/json',
    'Accept':        'text/event-stream',
    'Authorization': `Bearer ${accessToken}`,
  }
  // Required for ChatGPT auth mode — routes request to the right account/workspace
  if (accountId) {
    baseHeaders['ChatGPT-Account-ID'] = accountId
  }
  // Per-conversation routing headers (from codex-rs/core/src/client.rs)
  baseHeaders['x-client-request-id']    = conversationId
  baseHeaders['session_id']             = conversationId
  baseHeaders['x-codex-installation-id'] = INSTALLATION_ID

  let fullText = ''
  const maxIter = Math.max(1, settings.maxIterations ?? 50)

  for (let iteration = 0; iteration < maxIter; iteration++) {
    if (callbacks.abortSignal.aborted) break

    // Per-turn headers (new turn_id each iteration)
    const turnId   = randomUUID()
    const windowId = `${conversationId}:${iteration}`

    const turnHeaders: Record<string, string> = {
      ...baseHeaders,
      'x-codex-window-id':    windowId,
      'x-codex-turn-metadata': JSON.stringify({
        turn_id:      turnId,
        sandbox:      false,
        thread_source: 'chat',
      }),
    }

    // ── Build request body ──────────────────────────────────────────────────

    const reqBody: Record<string, unknown> = {
      model:                settings.model,
      instructions:         settings.systemPrompt?.trim() || 'You are a helpful assistant.',
      input:                history,
      tools:                allTools,
      tool_choice:          'auto',
      parallel_tool_calls:  false,
      store:                false,
      stream:               true,
      client_metadata: {
        'x-codex-installation-id': INSTALLATION_ID,
        'x-codex-window-id':       windowId,
      },
      ...(reasoningEffort
        ? {
            reasoning: { effort: reasoningEffort, summary: 'detailed' },
            include:   ['reasoning.encrypted_content'],
          }
        : {
            ...(settings.temperature !== undefined && { temperature: settings.temperature }),
            ...(settings.topP        !== undefined && { top_p:       settings.topP }),
          }
      ),
    }

    log.info('openai-codex-loop', `iteration ${iteration}`, {
      messageCount: history.length,
      model:        settings.model,
      accountId:    accountId ?? '(none)',
    })

    const response = await net.fetch(`${CHATGPT_CODEX_BASE}/responses`, {
      method:  'POST',
      headers: turnHeaders,
      body:    JSON.stringify(reqBody),
      signal:  callbacks.abortSignal,
    })

    if (!response.ok) {
      const text = await response.text()
      log.error('openai-codex-loop', 'API error', { status: response.status, body: text.slice(0, 500) })
      throw new Error(`ChatGPT Codex API error ${response.status}: ${text.slice(0, 300)}`)
    }

    // ── Parse SSE stream ────────────────────────────────────────────────────

    const reader  = response.body!.getReader()
    const decoder = new TextDecoder()
    let   buffer  = ''

    // Accumulate function call arguments indexed by call_id (call_xxx)
    // itemId = the fc_xxx prefixed ID required by the Responses API history
    const localCallAccum = new Map<string, { name: string; argsJson: string; itemId: string }>()
    let assistantText = ''

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
        if (data === '[DONE]') break

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

        // Reasoning summary (show inline as italic text)
        if (type === 'response.reasoning_summary_text.delta') {
          const delta = (event.delta as string) ?? ''
          if (delta) {
            const wrapped = `*${delta}*`
            callbacks.onTextChunk(wrapped)
            assistantText += wrapped
            fullText      += wrapped
          }
        }

        // Function call name + IDs arrive via output_item.added
        // item.id     = fc_xxx  (the Responses API item ID — must be used in history)
        // item.call_id = call_xxx (links to function_call_output — used as map key)
        if (type === 'response.output_item.added') {
          const item = event.item as Record<string, unknown> | undefined
          if (item?.type === 'function_call') {
            const callId = item.call_id as string      // call_xxx — link / map key
            const itemId = item.id     as string       // fc_xxx   — required in history id
            const name   = item.name   as string
            if (!localCallAccum.has(callId)) {
              localCallAccum.set(callId, { name, argsJson: '', itemId })
            } else {
              const entry = localCallAccum.get(callId)!
              entry.name   = name
              entry.itemId = itemId
            }
          }
        }

        // Function call argument chunks.
        // The Responses API sends item_id (fc_xxx) on delta events, NOT call_id.
        // We registered the entry under call_id (call_xxx) from output_item.added,
        // so we must look up by itemId when call_id is missing or doesn't match.
        if (type === 'response.function_call_arguments.delta') {
          const evCallId = event.call_id as string | undefined
          const evItemId = event.item_id as string | undefined
          const delta    = (event.delta as string) ?? ''

          // 1. Try direct lookup by call_id
          let key = evCallId && localCallAccum.has(evCallId) ? evCallId : undefined

          // 2. Fall back: find the entry whose itemId matches the event's item_id
          if (!key && evItemId) {
            for (const [k, v] of localCallAccum) {
              if (v.itemId === evItemId) { key = k; break }
            }
          }

          // 3. Still not found — create a placeholder (covers edge cases)
          if (!key) {
            key = evCallId ?? evItemId ?? `fc_${Date.now()}`
            localCallAccum.set(key, { name: '', argsJson: '', itemId: evItemId ?? `fc_${key}` })
          }

          localCallAccum.get(key)!.argsJson += delta
        }

        // response.completed / response.failed for logging
        if (type === 'response.failed') {
          const err = event.error as Record<string, unknown> | undefined
          log.error('openai-codex-loop', 'response.failed', { code: err?.code, message: err?.message })
        }
      }
    }

    if (callbacks.abortSignal.aborted) break

    const localCalls = [...localCallAccum.entries()].filter(([, v]) => v.name)

    if (localCalls.length === 0) break   // no tool calls — done

    // ── Append assistant turn using Responses API item format ───────────────
    // Rules:
    //   • Assistant text → { role:'assistant', content:[{ type:'output_text', text }] }
    //   • Function calls → top-level FuncCallItem entries (NOT inside content)
    //   • Both can coexist in the same turn; text comes first

    if (assistantText.trim()) {
      history.push({ role: 'assistant', content: [{ type: 'output_text', text: assistantText }] })
    }
    for (const [callId, call] of localCalls) {
      // id must be the fc_xxx value; call_id is the call_xxx link key
      const itemId = call.itemId?.startsWith('fc') ? call.itemId : `fc_${callId}`
      history.push({
        type:      'function_call',
        id:        itemId,
        call_id:   callId,
        name:      call.name,
        arguments: call.argsJson,
      })
    }

    // ── Execute tools and append results ────────────────────────────────────

    for (const [callId, call] of localCalls) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(call.argsJson || '{}') } catch { /* empty */ }

      callbacks.onToolCallStart(callId, call.name, input)

      const result = await executeTool(
        call.name, input,
        settings.workspacePath ?? '',
        callbacks.onDiffRequest,
        (chunk: string) => callbacks.onToolOutputChunk(callId, chunk),
        undefined,
      )

      callbacks.onToolCallResult(callId, result.output, result.isError)

      // Responses API format for tool results
      history.push({
        type:    'function_call_output',
        call_id: callId,
        output:  result.output,
      })
    }
  }

  return fullText
}
