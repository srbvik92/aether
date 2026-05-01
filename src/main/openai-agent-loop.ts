/**
 * Agent loop for OpenAI (and OpenAI-compatible) models with function calling.
 *
 * Mirrors the Anthropic agent loop pattern but uses OpenAI's API format:
 *   - Tools defined as `tools: [{ type:'function', function: { name, description, parameters } }]`
 *   - AI returns `tool_calls` array in the assistant message
 *   - Results go back as messages with `role: 'tool'`
 *
 * Stop condition: finish_reason === 'stop' (no more tool calls).
 */

import OpenAI from 'openai'
import { AppSettings, MessageRole, ImageAttachment, supportsReasoningDepth } from '../shared/types'
import { executeTool, getCustomPlugins, runAutoValidator, DiffApprovalFn } from './tools'
import { getActiveMcpTools, callMcpTool } from './mcp-client'

/** Convert active MCP servers' tools into OpenAI tool definitions. */
function getMcpToolsForOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return getActiveMcpTools().map(({ serverId, tool }) => ({
    type: 'function' as const,
    function: {
      name:        `mcp__${serverId}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      description: `[MCP] ${tool.description}`,
      parameters:  (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {}, required: [] }
    }
  }))
}

const MAX_ITERATIONS = 10   // fallback only — overridden by settings.maxIterations

export interface OpenAIAgentCallbacks {
  onTextChunk:       (text: string) => void
  onToolCallStart:   (callId: string, name: string, input: Record<string, unknown>) => void
  onToolCallResult:  (callId: string, output: string, isError: boolean) => void
  onToolOutputChunk: (callId: string, chunk: string) => void
  onDiffRequest:     DiffApprovalFn
  abortSignal:       AbortSignal
  onUsage?:          (inputTokens: number, outputTokens: number) => void
}

// ── OpenAI tool definitions (mirrors ANTHROPIC_TOOLS format) ─────────────────
const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file with line numbers prefixed. Always read before editing.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to workspace root' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file_range',
      description: 'Read a specific range of lines from a file. Use instead of read_file for large files.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string', description: 'File path relative to workspace root' },
          start_line: { type: 'number', description: 'First line to read (1-indexed)' },
          end_line:   { type: 'number', description: 'Last line to read (inclusive)' }
        },
        required: ['path', 'start_line', 'end_line']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'str_replace',
      description: 'Make a surgical edit by replacing an exact unique string in a file. PREFER this over write_file for edits.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'File path relative to workspace root' },
          old_str: { type: 'string', description: 'Exact text to replace (must be unique in the file)' },
          new_str: { type: 'string', description: 'Replacement text' }
        },
        required: ['path', 'old_str', 'new_str']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write/overwrite an entire file. Use only for new files or full rewrites — prefer str_replace for edits.',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'File path relative to workspace root' },
          content: { type: 'string', description: 'Full file content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and subdirectories at a given path.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path relative to workspace root. Defaults to ".".' } },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a text pattern across all files (like grep). Returns matching lines with file path and line number.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex or literal text to search for' },
          path:    { type: 'string', description: 'Directory to search in. Defaults to ".".' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: (() => {
        const shell = process.platform === 'win32' ? 'PowerShell' : process.platform === 'darwin' ? 'zsh' : 'bash'
        const hint  = process.platform === 'win32'
          ? 'Use PowerShell syntax (not bash). E.g. `New-Item -ItemType Directory` not `mkdir -p`, `Remove-Item -Recurse` not `rm -rf`.'
          : 'Use bash/sh syntax.'
        return `Execute a shell command. Shell: ${shell}. cwd is always workspace root. ${hint} Do NOT cd into subdirs — use relative paths. Timeout: 5 min for npm/pip/cargo, 30s otherwise.`
      })(),
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command to execute' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Show git status: branch, staged/unstaged/untracked files, ahead/behind remote.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show git diff. staged=true for index vs HEAD, false for working tree vs index.',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Show staged diff?' },
          path:   { type: 'string',  description: 'Limit to specific file path (optional)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Show recent commit history.',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'Number of commits (default 10)' } },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_add',
      description: 'Stage files for commit. Use paths=["."] to stage everything.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'File paths to stage' }
        },
        required: ['paths']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Commit staged changes with a message.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Commit message' } },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description:
        'Search the codebase by meaning / concept rather than exact text. ' +
        'Returns the most relevant file sections ranked by relevance. ' +
        'Use this when you need to find code related to a concept or feature ' +
        'and don\'t know the exact file or function name.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language description of what you are looking for'
          },
          top_k: {
            type: 'number',
            description: 'Number of results (default 5)'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        'Save an important fact about this project to persistent memory. ' +
        'The note is injected into every future conversation automatically. ' +
        'Use for preferences, constraints, architectural decisions, or conventions ' +
        'the user wants the AI to always know.',
      parameters: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'The fact or preference to remember, as a clear concise statement'
          }
        },
        required: ['note']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch the content of any URL and return it as readable text. Use when the user shares a link.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The full URL to fetch' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information, docs, or error messages not in the codebase.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember_globally',
      description: 'Save a fact or preference that applies to ALL projects and future conversations.',
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: 'The global preference or fact to remember' }
        },
        required: ['note']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_plan',
      description: 'Write your step-by-step plan BEFORE editing when a task touches multiple files. Call this first.',
      parameters: {
        type: 'object',
        properties: {
          plan: { type: 'string', description: 'Markdown plan: each file, what changes, why, and shared contracts to keep consistent.' }
        },
        required: ['plan']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_project_summary',
      description:
        'Save a comprehensive PROJECT.md to .ai-context/PROJECT.md. Call after completing any significant task. ' +
        'Lets any AI tool (Claude, Cursor, ChatGPT, Codex) instantly understand the project.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Full markdown content: overview, tech stack, architecture, key files, conventions, recent changes, in-progress items.'
          }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_database',
      description: 'Run a SQL query against SQLite (file path) or PostgreSQL (postgres:// URL). Returns a markdown table.',
      parameters: {
        type: 'object',
        properties: {
          connection_string: { type: 'string', description: 'SQLite path or postgres:// URL' },
          sql:               { type: 'string', description: 'SQL query to execute' }
        },
        required: ['connection_string', 'sql']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Navigate a headless Chromium browser to a URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to open' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the current browser page using a CSS selector.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector to click' } },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_fill',
      description: 'Fill a form input on the current browser page.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of input' },
          value:    { type: 'string', description: 'Value to type' }
        },
        required: ['selector', 'value']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_text',
      description: 'Get visible text from the current page or a specific element.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector (optional — omit for full page)' } },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current browser page.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_docker',
      description: 'Run a command in a Docker container with workspace mounted at /workspace.',
      parameters: {
        type: 'object',
        properties: {
          image:   { type: 'string', description: 'Docker image name' },
          command: { type: 'string', description: 'Command to run' }
        },
        required: ['image', 'command']
      }
    }
  },
]

// Filter out workspace-dependent tools when no folder is set
function getOpenAITools(workspacePath: string): OpenAI.Chat.Completions.ChatCompletionTool[] {
  if (workspacePath) return OPENAI_TOOLS
  const WS_TOOLS = new Set([
    'read_file', 'read_file_range', 'str_replace', 'write_file',
    'list_directory', 'search_files', 'run_command', 'run_docker',
    'git_status', 'git_diff', 'git_log', 'git_add', 'git_commit',
    'semantic_search', 'remember', 'write_plan', 'update_project_summary',
    'query_database',
  ])
  return OPENAI_TOOLS.filter(t => !WS_TOOLS.has(t.function.name))
}

export async function runOpenAIAgentLoop(
  messages: { role: MessageRole; content: string; images?: ImageAttachment[] }[],
  settings: AppSettings,
  callbacks: OpenAIAgentCallbacks
): Promise<string> {
  const client = new OpenAI({
    apiKey:  settings.apiKey,
    baseURL: settings.baseUrl || undefined
  })

  // Build mutable history in OpenAI format
  type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

  let history: OAIMessage[] = messages.map(m => {
    // Build multi-part content when the user message has image attachments
    if (m.role === 'user' && m.images && m.images.length > 0) {
      const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        ...m.images.map(img => ({
          type:      'image_url' as const,
          image_url: { url: `data:${img.mimeType};base64,${img.data}` }
        })),
        ...(m.content.trim() ? [{ type: 'text' as const, text: m.content }] : [])
      ]
      return { role: 'user' as const, content: parts }
    }
    return {
      role:    m.role as 'user' | 'assistant' | 'system',
      content: m.content
    }
  })

  let fullText = ''
  let totalInputTokens  = 0
  let totalOutputTokens = 0
  const maxIter = Math.max(1, settings.maxIterations ?? MAX_ITERATIONS)

  for (let iteration = 0; iteration < maxIter; iteration++) {
    if (callbacks.abortSignal.aborted) break

    // ── Stream this turn ──────────────────────────────────────────────────
    const isOSeries = supportsReasoningDepth('openai', settings.model)
    const reasoningEffort = (settings.reasoningDepth && settings.reasoningDepth !== 'off' && isOSeries)
      ? settings.reasoningDepth
      : undefined

    const stream = await client.chat.completions.create({
      model:      settings.model,
      max_tokens: settings.maxTokens,
      // o-series: use reasoning_effort instead of temperature/top_p
      ...(reasoningEffort
        ? { reasoning_effort: reasoningEffort }
        : {
            ...(settings.temperature !== undefined && { temperature: settings.temperature }),
            ...(settings.topP        !== undefined && { top_p:       settings.topP }),
          }
      ),
      tools: [
        ...getOpenAITools(settings.workspacePath),
        ...getCustomPlugins().map(p => ({
          type: 'function' as const,
          function: {
            name:        p.name,
            description: p.description,
            parameters:  { type: 'object', properties: p.parameters, required: [] }
          }
        })),
        ...getMcpToolsForOpenAI()
      ],
      tool_choice: 'auto',
      messages:   history,
      stream:     true,
      stream_options: { include_usage: true }
    })

    // Accumulate streamed tool call deltas
    const toolCallAccum = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >()
    let assistantText = ''

    for await (const chunk of stream) {
      if (callbacks.abortSignal.aborted) break

      const delta   = chunk.choices[0]?.delta
      const finish  = chunk.choices[0]?.finish_reason

      // Text chunk
      if (delta?.content) {
        callbacks.onTextChunk(delta.content)
        assistantText += delta.content
        fullText      += delta.content
      }

      // Tool call accumulation
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCallAccum.has(idx)) {
            toolCallAccum.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', argsJson: '' })
          }
          const acc = toolCallAccum.get(idx)!
          if (tc.id)                acc.id       = tc.id
          if (tc.function?.name)    acc.name     = tc.function.name
          if (tc.function?.arguments) acc.argsJson += tc.function.arguments
        }
      }

      // Usage is sent in the final chunk when stream_options.include_usage is true
      if (chunk.usage) {
        totalInputTokens  += chunk.usage.prompt_tokens     ?? 0
        totalOutputTokens += chunk.usage.completion_tokens ?? 0
      }
    }

    if (callbacks.abortSignal.aborted) break

    const toolCalls = [...toolCallAccum.values()]

    if (toolCalls.length === 0) {
      // No tool calls — done
      break
    }

    // ── Append assistant message with tool_calls ──────────────────────────
    const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
      role:       'assistant',
      content:    assistantText || null,
      tool_calls: toolCalls.map(tc => ({
        id:       tc.id,
        type:     'function' as const,
        function: { name: tc.name, arguments: tc.argsJson }
      }))
    }
    history = [...history, assistantMsg]

    // ── Execute each tool ─────────────────────────────────────────────────
    const toolResultMsgs: OAIMessage[] = []

    for (const tc of toolCalls) {
      if (callbacks.abortSignal.aborted) break

      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.argsJson) } catch { /* malformed args */ }

      callbacks.onToolCallStart(tc.id, tc.name, input)

      // Route MCP tools to callMcpTool; everything else to executeTool
      let result: { output: string; isError: boolean }
      if (tc.name.startsWith('mcp__')) {
        const [, serverId, ...toolParts] = tc.name.split('__')
        const toolName = toolParts.join('__')
        const mcpResult = await callMcpTool(serverId, toolName, input)
        result = { output: mcpResult.ok ? mcpResult.output : (mcpResult.error ?? 'MCP tool error'), isError: !mcpResult.ok }
      } else {
        result = await executeTool(
          tc.name, input, settings.workspacePath, callbacks.onDiffRequest,
          (chunk) => callbacks.onToolOutputChunk(tc.id, chunk),
          settings.braveApiKey,
          tc.id
        )
      }

      // ── Verify-after-write + auto-validate ───────────────────────────────
      let finalOutput = result.output
      if (!result.isError && (tc.name === 'str_replace' || tc.name === 'write_file')) {
        const filePath = input.path as string
        if (filePath) {
          const verify = await executeTool('read_file', { path: filePath }, settings.workspacePath, undefined, undefined, settings.braveApiKey)
          if (!verify.isError) finalOutput = result.output + '\n\n[File after edit:]\n' + verify.output
        }
        const validationError = await runAutoValidator(settings.workspacePath)
        if (validationError) finalOutput += validationError
      }

      callbacks.onToolCallResult(tc.id, finalOutput, result.isError)

      toolResultMsgs.push({
        role:         'tool',
        tool_call_id: tc.id,
        content:      finalOutput
      })
    }

    if (toolResultMsgs.length === 0) break

    // ── Add tool results to history, loop ─────────────────────────────────
    history = [...history, ...toolResultMsgs]
  }

  callbacks.onUsage?.(totalInputTokens, totalOutputTokens)
  return fullText
}
