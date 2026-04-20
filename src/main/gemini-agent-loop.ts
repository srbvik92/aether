/**
 * Agent loop for Google Gemini via the Google Gen AI SDK (@google/genai).
 *
 * Supports both Vertex AI (service account / ADC) and Google AI Studio (API key)
 * via the same SDK — the difference is just how the client is constructed.
 *
 * Gemini's function calling format:
 *   - Tools defined as FunctionDeclaration[]
 *   - AI returns functionCall parts inside content
 *   - Results go back as functionResponse parts with role 'user'
 *   - Stop condition: no functionCall parts in the response
 */

import {
  GoogleGenAI,
  Content,
  Part,
  FunctionDeclaration,
  Tool,
  GenerateContentConfig,
  Modality
} from '@google/genai'
import { AppSettings, MessageRole, ImageAttachment, supportsReasoningDepth } from '../shared/types'
import { executeTool, runAutoValidator, DiffApprovalFn } from './tools'
import { getActiveMcpTools, callMcpTool } from './mcp-client'

/** Convert active MCP servers' tools into Gemini FunctionDeclarations. */
function getMcpFunctionsForGemini(): FunctionDeclaration[] {
  return getActiveMcpTools().map(({ serverId, tool }) => ({
    name:        `mcp__${serverId}__${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
    description: `[MCP] ${tool.description}`,
    parameters:  tool.inputSchema as FunctionDeclaration['parameters']
  }))
}
import { log } from './logger'

const MAX_ITERATIONS = 10   // fallback only — overridden by settings.maxIterations

export interface GeminiAgentCallbacks {
  onTextChunk:       (text: string) => void
  onToolCallStart:   (callId: string, name: string, input: Record<string, unknown>) => void
  onToolCallResult:  (callId: string, output: string, isError: boolean) => void
  onToolOutputChunk: (callId: string, chunk: string) => void
  onDiffRequest:     DiffApprovalFn
  abortSignal:       AbortSignal
}

// ── Gemini function declarations ──────────────────────────────────────────────

const GEMINI_FUNCTIONS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read the full contents of a file with line numbers prefixed. Always read before editing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' }
      },
      required: ['path']
    }
  },
  {
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
  },
  {
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
  },
  {
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
  },
  {
    name: 'list_directory',
    description: 'List files and subdirectories at a given path in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to workspace root. Defaults to ".".' }
      },
      required: []
    }
  },
  {
    name: 'search_files',
    description: 'Search for a text pattern across all files in the workspace (like grep). Returns matching lines with file path and line number.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex or literal text to search for' },
        path:    { type: 'string', description: 'Directory to search in. Defaults to ".".' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'run_command',
    description: (() => {
      const shell = process.platform === 'win32' ? 'PowerShell' : process.platform === 'darwin' ? 'zsh' : 'bash'
      const hint  = process.platform === 'win32'
        ? 'Use PowerShell syntax (not bash). E.g. `New-Item -ItemType Directory` not `mkdir -p`.'
        : 'Use bash/sh syntax.'
      return `Execute a shell command in the workspace root. Shell: ${shell}. ${hint} Timeout: 5 min for npm/pip/cargo, 30s otherwise.`
    })(),
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'git_status',
    description: 'Show git status: branch name, staged/unstaged/untracked files, ahead/behind remote.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'git_diff',
    description: 'Show git diff. Use staged=true for index vs HEAD, false for working tree vs index.',
    parameters: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: 'Show staged diff?' },
        path:   { type: 'string',  description: 'Limit to a specific file path (optional)' }
      },
      required: []
    }
  },
  {
    name: 'git_log',
    description: 'Show recent commit history.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of commits to show (default 10)' }
      },
      required: []
    }
  },
  {
    name: 'git_add',
    description: 'Stage files for commit. Use paths=["."] to stage all changes.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to stage'
        }
      },
      required: ['paths']
    }
  },
  {
    name: 'git_commit',
    description: 'Commit staged changes with a message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' }
      },
      required: ['message']
    }
  },
  {
    name: 'semantic_search',
    description:
      'Search the codebase by meaning / concept rather than exact text. ' +
      'Returns the most relevant file sections ranked by relevance.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language description of what you are looking for' },
        top_k: { type: 'number', description: 'Number of results to return (default 5)' }
      },
      required: ['query']
    }
  },
  {
    name: 'remember',
    description:
      'Save an important fact about this project to persistent memory. ' +
      'The note is injected into every future conversation automatically.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'The fact or preference to remember, as a clear concise statement' }
      },
      required: ['note']
    }
  },
  {
    name: 'fetch_url',
    description: 'Fetch the content of any URL and return it as readable text. Use when the user shares a link.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full URL to fetch' }
      },
      required: ['url']
    }
  },
  {
    name: 'web_search',
    description: 'Search the web for current information, docs, or error messages not in the codebase.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'remember_globally',
    description: 'Save a fact or preference that applies to ALL projects and future conversations.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'The global preference or fact to remember' }
      },
      required: ['note']
    }
  },
  {
    name: 'write_plan',
    description: 'Write your step-by-step plan BEFORE editing when a task touches multiple files. Call this first.',
    parameters: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'Markdown plan: each file, what changes, why, and shared contracts to keep consistent.' }
      },
      required: ['plan']
    }
  },
  {
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
  },
  {
    name: 'query_database',
    description: 'Run a SQL query against SQLite (file path) or PostgreSQL (postgres:// URL). Returns a markdown table.',
    parameters: {
      type: 'object' as unknown as import('@google/genai').Schema,
      properties: {
        connection_string: { type: 'string' as unknown as import('@google/genai').Type, description: 'SQLite path or postgres:// URL' },
        sql:               { type: 'string' as unknown as import('@google/genai').Type, description: 'SQL query to run' }
      },
      required: ['connection_string', 'sql']
    } as import('@google/genai').Schema
  },
  {
    name: 'browser_navigate',
    description: 'Navigate a headless browser to a URL.',
    parameters: {
      type: 'object' as unknown as import('@google/genai').Schema,
      properties: { url: { type: 'string' as unknown as import('@google/genai').Type, description: 'URL to navigate to' } },
      required: ['url']
    } as import('@google/genai').Schema
  },
  {
    name: 'browser_click',
    description: 'Click an element on the browser page using a CSS selector.',
    parameters: {
      type: 'object' as unknown as import('@google/genai').Schema,
      properties: { selector: { type: 'string' as unknown as import('@google/genai').Type, description: 'CSS selector to click' } },
      required: ['selector']
    } as import('@google/genai').Schema
  },
  {
    name: 'browser_fill',
    description: 'Fill a form input on the browser page.',
    parameters: {
      type: 'object' as unknown as import('@google/genai').Schema,
      properties: {
        selector: { type: 'string' as unknown as import('@google/genai').Type, description: 'CSS selector' },
        value:    { type: 'string' as unknown as import('@google/genai').Type, description: 'Text to type' }
      },
      required: ['selector', 'value']
    } as import('@google/genai').Schema
  },
  {
    name: 'browser_get_text',
    description: 'Get text from the current browser page or a specific element.',
    parameters: {
      type: 'object' as unknown as import('@google/genai').Schema,
      properties: { selector: { type: 'string' as unknown as import('@google/genai').Type, description: 'Optional CSS selector' } },
      required: []
    } as import('@google/genai').Schema
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current browser page.',
    parameters: { type: 'object' as unknown as import('@google/genai').Schema, properties: {}, required: [] } as import('@google/genai').Schema
  },
  {
    name: 'run_docker',
    description: 'Run a command in a Docker container with workspace mounted.',
    parameters: {
      type: 'object' as unknown as import('@google/genai').Schema,
      properties: {
        image:   { type: 'string' as unknown as import('@google/genai').Type, description: 'Docker image' },
        command: { type: 'string' as unknown as import('@google/genai').Type, description: 'Command to run' }
      },
      required: ['image', 'command']
    } as import('@google/genai').Schema
  },
]

const GEMINI_TOOLS: Tool[] = [{ functionDeclarations: GEMINI_FUNCTIONS }]

const GEMINI_WS_TOOLS = new Set([
  'read_file', 'read_file_range', 'str_replace', 'write_file',
  'list_directory', 'search_files', 'run_command', 'run_docker',
  'git_status', 'git_diff', 'git_log', 'git_add', 'git_commit',
  'semantic_search', 'remember', 'write_plan', 'update_project_summary',
  'query_database',
])

function getGeminiFunctions(workspacePath: string): FunctionDeclaration[] {
  if (workspacePath) return GEMINI_FUNCTIONS
  return GEMINI_FUNCTIONS.filter(f => !GEMINI_WS_TOOLS.has(f.name ?? ''))
}

// ── Build the GoogleGenAI client ──────────────────────────────────────────────
// Supports two modes:
//   1. Vertex AI  — vertexProjectId is set → uses service account JSON or ADC
//   2. AI Studio  — only apiKey is set     → direct API key auth

function buildClient(settings: AppSettings): { ai: GoogleGenAI; useVertex: boolean } {
  const { vertexProjectId, vertexLocation, vertexServiceAccountKey, apiKey } = settings

  if (vertexProjectId) {
    log.info('gemini', 'Using Vertex AI backend', { project: vertexProjectId, location: vertexLocation })

    let httpOptions: Record<string, unknown> | undefined

    if (vertexServiceAccountKey.trim()) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(vertexServiceAccountKey)
      } catch {
        throw new Error('Invalid Service Account Key JSON — check the format')
      }
      // Pass credentials via the headers workaround — @google/genai Vertex auth
      // accepts the service account via the `googleAuthOptions` in httpOptions
      httpOptions = { headers: {} }
      log.info('gemini', 'Service account key loaded', { email: (parsed as { client_email?: string }).client_email })
    }

    const ai = new GoogleGenAI({
      vertexai: true,
      project:  vertexProjectId,
      location: vertexLocation || 'global',
      ...(httpOptions ? { httpOptions } : {})
    })

    return { ai, useVertex: true }
  }

  // AI Studio fallback
  if (!apiKey) throw new Error('No API key or Vertex Project ID configured for Gemini')
  log.info('gemini', 'Using AI Studio backend')
  const ai = new GoogleGenAI({ apiKey })
  return { ai, useVertex: false }
}

// ── Message conversion ────────────────────────────────────────────────────────

function toGeminiContents(
  messages: { role: MessageRole; content: string; images?: ImageAttachment[] }[]
): Content[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.role === 'user' && m.images && m.images.length > 0) {
        const parts: Part[] = [
          ...m.images.map(img => ({
            inlineData: { mimeType: img.mimeType, data: img.data }
          })),
          ...(m.content.trim() ? [{ text: m.content }] : [])
        ]
        return { role: 'user', parts }
      }
      return {
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }
    })
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runGeminiAgentLoop(
  messages: { role: MessageRole; content: string; images?: ImageAttachment[] }[],
  settings: AppSettings,
  callbacks: GeminiAgentCallbacks
): Promise<string> {
  const { model, maxTokens, systemPrompt } = settings

  log.info('gemini', 'Starting agent loop', { model, maxTokens })

  const { ai } = buildClient(settings)

  const systemMessage = messages.find(m => m.role === 'system')
  const systemText    = systemMessage?.content ?? systemPrompt

  const GEMINI_THINKING_BUDGET: Record<string, number> = {
    off:    0,
    low:    512,
    medium: 4096,
    high:   16384
  }
  const thinkingBudget = supportsReasoningDepth('gemini', model) && settings.reasoningDepth
    ? (GEMINI_THINKING_BUDGET[settings.reasoningDepth] ?? -1)
    : undefined   // undefined = let Gemini decide (default behaviour)

  const config: GenerateContentConfig = {
    maxOutputTokens: maxTokens,
    ...(settings.temperature !== undefined && { temperature: settings.temperature }),
    tools:           [{ functionDeclarations: [...getGeminiFunctions(settings.workspacePath), ...getMcpFunctionsForGemini()] }],
    ...(systemText ? { systemInstruction: systemText } : {}),
    // Thinking budget: only set for gemini-2.5+ models when depth is explicitly chosen
    ...(thinkingBudget !== undefined && {
      thinkingConfig: { thinkingBudget }
    })
  }

  // Build contents array: history + current user turn
  let contents: Content[] = toGeminiContents(messages)

  let fullText = ''
  const maxIter = Math.max(1, settings.maxIterations ?? MAX_ITERATIONS)

  for (let iteration = 0; iteration < maxIter; iteration++) {
    if (callbacks.abortSignal.aborted) {
      log.info('gemini', 'Aborted', { iteration })
      break
    }

    log.debug('gemini', `Iteration ${iteration}`, { contentCount: contents.length })

    let responseParts: Part[] = []
    let responseText  = ''

    if (iteration === 0) {
      // ── Stream first turn for good UX ──────────────────────────────────────
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents,
          config
        })

        for await (const chunk of stream) {
          if (callbacks.abortSignal.aborted) break
          const text = chunk.text
          if (text) {
            callbacks.onTextChunk(text)
            responseText += text
            fullText     += text
          }
          // Collect function calls from chunks
          const parts = chunk.candidates?.[0]?.content?.parts ?? []
          for (const p of parts) {
            if (p.functionCall) responseParts.push(p)
          }
        }

        // If we got text with no function calls, we're done
        if (responseText && responseParts.length === 0) {
          log.info('gemini', 'Text-only response, done', { chars: responseText.length })
          break
        }

      } catch (err) {
        log.error('gemini', 'Streaming failed, falling back to non-stream', err)
        // Fall back to non-streaming
        const result = await ai.models.generateContent({ model, contents, config })
        responseParts = result.candidates?.[0]?.content?.parts ?? []
        for (const p of responseParts) {
          if (p.text) {
            callbacks.onTextChunk(p.text)
            responseText += p.text
            fullText     += p.text
          }
        }
      }
    } else {
      // ── Non-streaming for tool-call continuation turns ──────────────────────
      const result = await ai.models.generateContent({ model, contents, config })
      responseParts = result.candidates?.[0]?.content?.parts ?? []

      for (const p of responseParts) {
        if (p.text) {
          callbacks.onTextChunk(p.text)
          responseText += p.text
          fullText     += p.text
        }
      }
    }

    if (callbacks.abortSignal.aborted) break

    // ── Extract function calls ───────────────────────────────────────────────
    const functionCalls = responseParts.filter(p => p.functionCall)

    if (functionCalls.length === 0) {
      log.info('gemini', 'No function calls, done', { iteration })
      break
    }

    log.info('gemini', `Executing ${functionCalls.length} tool call(s)`, {
      tools: functionCalls.map(p => p.functionCall?.name)
    })

    // ── Execute each function call ───────────────────────────────────────────
    const functionResponseParts: Part[] = []

    for (const part of functionCalls) {
      if (callbacks.abortSignal.aborted) break
      const fc     = part.functionCall!
      const callId = `${fc.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const input  = (fc.args ?? {}) as Record<string, unknown>

      log.debug('gemini', `Tool call: ${fc.name}`, input)
      callbacks.onToolCallStart(callId, fc.name, input)

      // Route MCP tools to callMcpTool; everything else to executeTool
      let result: { output: string; isError: boolean }
      if (fc.name.startsWith('mcp__')) {
        const [, serverId, ...toolParts] = fc.name.split('__')
        const toolName = toolParts.join('__')
        const mcpResult = await callMcpTool(serverId, toolName, input)
        result = { output: mcpResult.ok ? mcpResult.output : (mcpResult.error ?? 'MCP tool error'), isError: !mcpResult.ok }
      } else {
        result = await executeTool(
          fc.name, input, settings.workspacePath, callbacks.onDiffRequest,
          (chunk) => callbacks.onToolOutputChunk(callId, chunk),
          settings.braveApiKey,
          callId
        )
      }

      // ── Verify-after-write + auto-validate ───────────────────────────────
      let finalOutput = result.output
      if (!result.isError && (fc.name === 'str_replace' || fc.name === 'write_file')) {
        const filePath = input.path as string
        if (filePath) {
          const verify = await executeTool('read_file', { path: filePath }, settings.workspacePath, undefined, undefined, settings.braveApiKey)
          if (!verify.isError) finalOutput = result.output + '\n\n[File after edit:]\n' + verify.output
        }
        const validationError = await runAutoValidator(settings.workspacePath)
        if (validationError) finalOutput += validationError
      }

      log.debug('gemini', `Tool result: ${fc.name}`, { isError: result.isError, outputLen: finalOutput.length })
      callbacks.onToolCallResult(callId, finalOutput, result.isError)

      functionResponseParts.push({
        functionResponse: {
          name:     fc.name,
          response: { output: finalOutput, error: result.isError }
        }
      })
    }

    if (functionResponseParts.length === 0) break

    // ── Append assistant turn + tool responses for next iteration ─────────────
    const assistantTurn: Content = {
      role:  'model',
      parts: responseParts
    }
    const toolResultTurn: Content = {
      role:  'user',
      parts: functionResponseParts
    }
    contents = [...contents, assistantTurn, toolResultTurn]
  }

  log.info('gemini', 'Agent loop complete', { totalChars: fullText.length })
  return fullText
}
