import { ipcMain, BrowserWindow, dialog, app, net } from 'electron'
import { execSync } from 'child_process'
import { writeFileSync, readdirSync, statSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join, relative, extname } from 'path'
import {
  IPC,
  AppSettings,
  Conversation,
  ChatSendPayload,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  ExportChatPayload,
  ToolCallStartPayload,
  ToolCallResultPayload,
  ToolOutputChunkPayload,
  ContextCompressingPayload,
  SessionChangesPayload,
  ChangedFile,
  SnapshotInfo,
  DiffRequestPayload,
  DiffResponsePayload,
  GitStatusSummary,
  CmdApprovalPayload,
  AgentPreset,
  McpServerConfig,
  JiraProject,
  JiraIssue,
  LinearIssue
} from '../shared/types'
import {
  getSettings,
  saveSettings,
  getConversations,
  saveConversation,
  deleteConversation
} from './store'
import { AIClient } from './api-client'
import { trackMessage, trackToolCall, trackError } from './telemetry'
import { runAnthropicAgentLoop } from './agent-loop'
import { runOpenAIAgentLoop } from './openai-agent-loop'
import { runGeminiAgentLoop } from './gemini-agent-loop'
import { withRetry } from './api-retry'
import { compressToContextWindow } from './context-manager'
import { log } from './logger'
import { buildWorkspaceSummary, invalidateCache } from './workspace-indexer'
import { DiffApprovalFn, setGlobalMemoryPath, setDisabledTools, setCmdApprovalFn, setTrustedCommands, isDangerousCommand, killRunningCommand } from './tools'
import { loadProjectConfig } from './project-config'
import { startSnapshot, backupFileForSnapshot, finalizeSnapshot, restoreSnapshot, toRelativePath } from './checkpoint'
import { getGitStatus, getGitDiff, isGitRepo } from './git'
import { checkForUpdates, downloadUpdate, installUpdate } from './updater'
import {
  createTerminalSession, writeTerminalSession, resizeTerminalSession, killTerminalSession, PTY_AVAILABLE
} from './terminal'
import {
  buildBM25, getIndexInfo, saveEmbeddingIndex, vectorSearch, readWorkspaceFiles
} from './semantic-search'
import { startApiServer, stopApiServer, isApiServerRunning, getApiServerPort } from './http-api-server'
import { startMcpServer, stopMcpServer, getMcpServerStatus } from './mcp-client'
import { setCustomPlugins, CustomPlugin } from './tools'
import {
  SemanticIndexStatusPayload, SaveEmbeddingsPayload, SemanticSearchResult
} from '../shared/types'

// ── Active streams (abort support) ────────────────────────────────────────────
const activeStreams = new Map<string, { abort: AbortController }>()

// ── Pending diff approvals (paused agent waiting for user) ────────────────────
const pendingDiffApprovals = new Map<string, (approved: boolean) => void>()

let diffCounter = 0
function genDiffId() { return `diff-${++diffCounter}-${Date.now()}` }

// ── Pending command approvals ─────────────────────────────────────────────────
const pendingCmdApprovals = new Map<string, (approved: boolean) => void>()

let cmdCounter = 0
function genCmdId() { return `cmd-${++cmdCounter}-${Date.now()}` }

function buildCmdApprovalFn(mainWindow: BrowserWindow) {
  return (command: string, workspace: string, isDangerous: boolean, callId?: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const id = genCmdId()
      pendingCmdApprovals.set(id, resolve)
      const payload: CmdApprovalPayload = { id, command, workspace, isDangerous, callId }
      mainWindow.webContents.send(IPC.CMD_APPROVAL_REQUEST, payload)
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDiffApprovalFn(mainWindow: BrowserWindow): DiffApprovalFn {
  return (path, before, after, isNew) =>
    new Promise<boolean>((resolve) => {
      const id = genDiffId()
      pendingDiffApprovals.set(id, resolve)
      const payload: DiffRequestPayload = { id, path, before, after, isNew }
      mainWindow.webContents.send(IPC.DIFF_REQUEST, payload)
    })
}

const MEMORY_FILE  = '.ai-memory/notes.md'
const SUMMARY_FILE = '.ai-context/PROJECT.md'

// ── API error classifier ──────────────────────────────────────────────────────
function classifyApiError(raw: string, model: string, provider: string): string {
  const msg = raw.toLowerCase()

  // Model not found / invalid model
  if (
    msg.includes('model_not_found') || msg.includes('model not found') ||
    msg.includes('does not exist') || msg.includes('no such model') ||
    (msg.includes('404') && (msg.includes('model') || msg.includes('not_found')))
  ) {
    return `Model "${model}" is not available for ${provider}. Please select a different model in Settings.`
  }

  // Authentication / API key issues
  if (
    msg.includes('401') || msg.includes('invalid api key') ||
    msg.includes('authentication') || msg.includes('unauthorized') ||
    msg.includes('api_key') || msg.includes('invalid_api_key')
  ) {
    return `Authentication failed. Your ${provider} API key may be invalid or expired. Please check it in Settings.`
  }

  // Quota / billing
  if (
    msg.includes('quota') || msg.includes('billing') ||
    msg.includes('insufficient_quota') || msg.includes('credit')
  ) {
    return `API quota exceeded for ${provider}. Check your usage limits or billing details.`
  }

  // Permission denied (model requires higher tier)
  if (msg.includes('403') || msg.includes('forbidden') || msg.includes('permission')) {
    return `Access denied for model "${model}". Your ${provider} plan may not include this model.`
  }

  // Rate limit (429)
  if (
    msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit') ||
    msg.includes('too many requests') || msg.includes('ratelimit') ||
    msg.includes('requests per minute') || msg.includes('tokens per minute')
  ) {
    return `Rate limit reached for ${provider}. Wait a moment and try again, or switch to a different model.`
  }

  // Server errors (5xx)
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') ||
      msg.includes('internal server error') || msg.includes('service unavailable') ||
      msg.includes('bad gateway') || msg.includes('overloaded')) {
    return `${provider} servers are experiencing issues (server error). Please try again in a moment.`
  }

  // Return original error if no pattern matched
  return raw
}

// ── Webhook helper ────────────────────────────────────────────────────────────
async function fireWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  const { default: https } = await import('https')
  const { default: http  } = await import('http')
  const body = JSON.stringify(payload)
  const parsed = new URL(url)
  const lib = parsed.protocol === 'https:' ? https : http
  await new Promise<void>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || undefined,
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => { res.resume(); resolve() }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function readProjectMemory(workspacePath: string): string {
  try {
    const absPath = join(workspacePath, MEMORY_FILE)
    if (!existsSync(absPath)) return ''
    return readFileSync(absPath, 'utf-8').trim()
  } catch { return '' }
}

function readProjectSummary(workspacePath: string): string {
  try {
    const absPath = join(workspacePath, SUMMARY_FILE)
    if (!existsSync(absPath)) return ''
    // Strip the HTML comment timestamp header before injecting
    return readFileSync(absPath, 'utf-8').replace(/^<!--.*?-->\n?/, '').trim()
  } catch { return '' }
}

function readGlobalMemoryContent(): string {
  try {
    const path = join(app.getPath('userData'), 'global-memory.md')
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf-8').trim()
  } catch { return '' }
}

const PINS_FILE = '.ai-context/pins.json'

function loadPinnedFiles(workspacePath: string): string {
  try {
    const pinsPath = join(workspacePath, PINS_FILE)
    if (!existsSync(pinsPath)) return ''
    const pins = JSON.parse(readFileSync(pinsPath, 'utf-8')) as string[]
    if (!pins.length) return ''
    const sections: string[] = []
    for (const relPath of pins) {
      try {
        const abs = join(workspacePath, relPath)
        if (!existsSync(abs)) continue
        const content = readFileSync(abs, 'utf-8')
        const lines   = content.split('\n')
        const capped  = lines.slice(0, 200).join('\n')
        const note    = lines.length > 200 ? `\n[...truncated at 200 lines]` : ''
        sections.push(`### ${relPath}\n\`\`\`\n${capped}${note}\n\`\`\``)
      } catch { /* skip unreadable */ }
    }
    return sections.join('\n\n')
  } catch { return '' }
}

// ── OS / shell context (computed once at startup) ────────────────────────────
const OS_PLATFORM = process.platform  // 'win32' | 'darwin' | 'linux'
const OS_LABEL    = OS_PLATFORM === 'win32' ? 'Windows' : OS_PLATFORM === 'darwin' ? 'macOS' : 'Linux'
// Default shell: PowerShell on Windows (available on all modern Windows), bash elsewhere
const DEFAULT_SHELL = OS_PLATFORM === 'win32' ? 'PowerShell (Windows)' : OS_PLATFORM === 'darwin' ? 'zsh (macOS)' : 'bash (Linux)'

// Commands that differ across platforms — hint the AI to use the right ones
const OS_COMMAND_HINTS = OS_PLATFORM === 'win32'
  ? `Commands run in **PowerShell** (powershell.exe). Rules:
- ALWAYS use PowerShell syntax — never bash syntax.
- Create directory: \`New-Item -ItemType Directory -Name foo\` or \`mkdir foo\` (mkdir is an alias in PS)
- List files: \`Get-ChildItem\` or \`ls\` (ls is an alias in PS)
- Copy: \`Copy-Item src dst\`
- Move: \`Move-Item src dst\`
- Delete file: \`Remove-Item file\`
- Delete directory: \`Remove-Item -Recurse -Force dir\`
- Environment variable: \`$env:VAR\` (not \$VAR)
- Chain commands (run regardless of exit code): use separate run_command calls OR \`; \`
- Chain commands (stop on error): \`cmd1; if ($?) { cmd2 }\` — do NOT use \`&&\` in PS 5.1
- Read file: \`Get-Content file\` or \`type file\`
- Grep equivalent: \`Select-String -Pattern "foo" file\`
- npm, node, python, git, npx all work the same.
- IMPORTANT: For multi-step setup (mkdir + npm init + npm install), use SEPARATE run_command tool calls — do not chain them all in one command.`
  : OS_PLATFORM === 'darwin'
    ? 'Use standard bash/zsh commands. macOS uses BSD versions of tools (e.g. sed, awk may differ from GNU). Use \`open\` to open files/URLs.'
    : 'Use standard bash commands (GNU/Linux).'

function injectWorkspaceContext(settings: AppSettings): AppSettings {
  const globalMemory   = readGlobalMemoryContent()
  const memory         = settings.workspacePath ? readProjectMemory(settings.workspacePath) : ''
  const projectSummary = settings.workspacePath ? readProjectSummary(settings.workspacePath) : ''
  const fileSummary    = settings.workspacePath ? buildWorkspaceSummary(settings.workspacePath) : ''
  const projectConfig  = settings.workspacePath ? loadProjectConfig(settings.workspacePath) : null
  const pinnedFiles    = settings.workspacePath ? loadPinnedFiles(settings.workspacePath) : ''

  let merged: AppSettings = { ...settings }

  // Apply project config overrides (model/provider/maxIterations for new conversations)
  if (projectConfig) {
    if (projectConfig.model)         merged = { ...merged, model:         projectConfig.model }
    if (projectConfig.provider)      merged = { ...merged, provider:      projectConfig.provider }
    if (projectConfig.maxIterations) merged = { ...merged, maxIterations: projectConfig.maxIterations }
    if (projectConfig.disabledTools) merged = { ...merged, disabledTools: projectConfig.disabledTools }
  }

  // ── Always inject OS/shell context first ────────────────────────────────
  let extra = `\n\n---\n## Environment\n- **OS**: ${OS_LABEL} (${OS_PLATFORM})\n- **Shell**: ${DEFAULT_SHELL}\n- **Workspace**: ${settings.workspacePath || '(none set)'}\n\n${OS_COMMAND_HINTS}\n---`

  if (globalMemory)  extra += `\n\n---\n## Global Memory (applies to all projects)\n${globalMemory}\n---`
  if (pinnedFiles)    extra += `\n\n---\n## Pinned Context Files (always in context)\n\n${pinnedFiles}\n---`
  if (projectSummary) extra += `\n\n---\n## Project Summary (.ai-context/PROJECT.md)\n${projectSummary}\n---`
  if (memory)         extra += `\n\n---\n## Project Memory\n${memory}\n---`
  if (fileSummary)    extra += `\n\n---\n${fileSummary}\n---`

  // Project config system prompt additions
  if (projectConfig) {
    const configExtras: string[] = []
    if (projectConfig.systemPrompt) {
      configExtras.push(projectConfig.systemPrompt.trim())
    }
    if (projectConfig.rules?.length) {
      const numbered = projectConfig.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')
      configExtras.push(`## Project Rules (.chatui)\n\nThese rules are mandatory for this workspace:\n${numbered}`)
    }
    if (projectConfig.disabledTools?.length) {
      configExtras.push(`## Restricted Tools\n\nThe following tools are disabled for this workspace: ${projectConfig.disabledTools.map(t => `\`${t}\``).join(', ')}. Do not attempt to call them.`)
    }
    if (configExtras.length > 0) {
      extra += `\n\n---\n## Project Configuration (.chatui)\n\n${configExtras.join('\n\n')}\n---`
    }
  }

  if (!extra) return merged
  return { ...merged, systemPrompt: merged.systemPrompt + extra }
}

// ── Register all handlers ─────────────────────────────────────────────────────

export function registerIpcHandlers(mainWindow: BrowserWindow): void {

  // Set the global memory path once — tools.ts reads it for remember_globally
  setGlobalMemoryPath(join(app.getPath('userData'), 'global-memory.md'))

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_SETTINGS, () => getSettings())

  ipcMain.handle(IPC.SAVE_SETTINGS, (_event, incoming: AppSettings) => {
    const prev = getSettings()
    let settings = incoming

    // Maintain recent workspaces list (max 8, most-recent first, deduped)
    if (settings.workspacePath && settings.workspacePath !== prev.workspacePath) {
      const existing = prev.recentWorkspaces ?? []
      const recents  = [
        settings.workspacePath,
        ...existing.filter(p => p !== settings.workspacePath)
      ].slice(0, 8)
      settings = { ...settings, recentWorkspaces: recents }
      invalidateCache(prev.workspacePath)
    }

    saveSettings(settings)
    return { ok: true }
  })

  // ── Conversations ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.CONV_LIST,   ()                        => getConversations())
  ipcMain.handle(IPC.CONV_SAVE,   (_e, conv: Conversation)  => { saveConversation(conv);   return { ok: true } })
  ipcMain.handle(IPC.CONV_DELETE, (_e, id: string)          => { deleteConversation(id);    return { ok: true } })

  // ── Chat streaming ────────────────────────────────────────────────────────
  //
  //  Routing:
  //    anthropic → runAnthropicAgentLoop  (tool use)
  //    openai    → runOpenAIAgentLoop     (function calling)
  //    custom    → runOpenAIAgentLoop     (same format, custom baseURL)
  //    gemini    → AIClient plain stream  (tool use coming later)
  //
  //  Before sending: trim history to context window + inject workspace index

  ipcMain.handle(IPC.CHAT_SEND, async (_event, payload: ChatSendPayload) => {
    const { conversationId, messages, settings: rawSettings } = payload

    // Per-conversation workspace is the ONLY allowed path for file tools.
    // If the chat has no folder set, clear the global setting so no file
    // operations are possible — prevents accidental writes to userData or CWD.
    rawSettings.workspacePath = payload.workspacePath ?? ''

    log.info('ipc', 'chat:send', {
      conversationId,
      provider: rawSettings.provider,
      model:    rawSettings.model,
      messageCount: messages.length,
      workspace: rawSettings.workspacePath ?? '(none)'
    })

    activeStreams.get(conversationId)?.abort.abort()
    const abort = new AbortController()
    activeStreams.set(conversationId, { abort })

    const chatMode = payload.mode ?? 'code'

    // ── Pre-processing ──────────────────────────────────────────────────────
    let settingsWithWorkspace = injectWorkspaceContext(rawSettings)

    // Apply disabled-tool list from project config so executeTool can enforce it
    setDisabledTools(settingsWithWorkspace.disabledTools ?? [])

    // Set up command approval gate for this turn
    // If autoApproveCommands is on, use an approval fn that auto-approves
    // non-dangerous commands (dangerous ones still get the modal).
    if (rawSettings.autoApproveCommands) {
      setCmdApprovalFn((_cmd: string, _workspace: string, isDangerous: boolean, callId?: string): Promise<boolean> => {
        if (!isDangerous) return Promise.resolve(true)
        // dangerous → still show modal
        return buildCmdApprovalFn(mainWindow)(_cmd, _workspace, isDangerous, callId)
      })
    } else {
      setCmdApprovalFn(buildCmdApprovalFn(mainWindow))
    }
    setTrustedCommands(rawSettings.trustedCommands ?? [])

    // Load custom tool plugins from .ai-context/tools/*.js (if workspace set)
    if (rawSettings.workspacePath) {
      const pluginsDir = join(rawSettings.workspacePath, '.ai-context', 'tools')
      const plugins: CustomPlugin[] = []
      if (existsSync(pluginsDir)) {
        try {
          const files = readdirSync(pluginsDir).filter(f => f.endsWith('.js'))
          for (const file of files) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const mod = require(join(pluginsDir, file))
              if (mod && typeof mod.name === 'string' && typeof mod.execute === 'function') {
                plugins.push({
                  name:        mod.name,
                  description: mod.description ?? `Custom tool: ${mod.name}`,
                  parameters:  mod.parameters ?? {},
                  execute:     mod.execute
                })
              }
            } catch (e) {
              log(`[plugins] Failed to load ${file}: ${e}`)
            }
          }
        } catch { /* ignore scandir errors */ }
      }
      setCustomPlugins(plugins)
    } else {
      setCustomPlugins([])
    }

    const { messages: trimmedMessages, wasCompressed } = await compressToContextWindow(
      messages, rawSettings.model, rawSettings,
      () => mainWindow.webContents.send(IPC.CONTEXT_COMPRESSING, { conversationId } as ContextCompressingPayload)
    )

    if (wasCompressed) {
      log.info('ipc', 'Context compressed', { conversationId, originalCount: messages.length, trimmedCount: trimmedMessages.length })
    }

    // Only show diff approval when the setting is enabled (default: true)
    const onDiffRequest = rawSettings.requireEditApproval !== false
      ? buildDiffApprovalFn(mainWindow)
      : undefined

    // Track all files written during this turn for the session change summary
    const sessionChangedFiles: ChangedFile[] = []
    // callId → { name, input } so we can record the file path when the result arrives
    const pendingTools = new Map<string, { name: string; input: Record<string, unknown> }>()

    // ── Snapshot / checkpoint tracking ───────────────────────────────────────
    let currentSnapshotId: string | null = null
    const snapshotedPaths = new Set<string>()   // relative paths already backed up

    const onTextChunk = (chunk: string) => {
      if (abort.signal.aborted) return
      mainWindow.webContents.send(IPC.STREAM_CHUNK, { conversationId, chunk } as StreamChunkPayload)
    }
    const onToolCallStart = (callId: string, name: string, input: Record<string, unknown>) => {
      if (abort.signal.aborted) return

      // ── Lazily create a snapshot before the first file write ──────────────
      // onToolCallStart is called synchronously before executeTool, so the
      // backup is written before the file is modified.
      const workspace = rawSettings.workspacePath
      if (workspace && (name === 'str_replace' || name === 'write_file')) {
        const rawPath = (input.path as string | undefined)?.trim()
        if (rawPath) {
          const relPath = toRelativePath(workspace, rawPath)
          if (!snapshotedPaths.has(relPath)) {
            snapshotedPaths.add(relPath)
            if (!currentSnapshotId) {
              currentSnapshotId = startSnapshot(workspace)
            }
            backupFileForSnapshot(workspace, currentSnapshotId, relPath)
          }
        }
      }

      pendingTools.set(callId, { name, input })
      trackToolCall(name)
      mainWindow.webContents.send(IPC.TOOL_CALL_START, { conversationId, callId, name, input } as ToolCallStartPayload)
    }
    const onToolCallResult = (callId: string, output: string, isError: boolean) => {
      if (abort.signal.aborted) return
      // Record file writes for session change summary
      const pending = pendingTools.get(callId)
      pendingTools.delete(callId)
      if (!isError && pending && (pending.name === 'str_replace' || pending.name === 'write_file')) {
        const filePath = (pending.input.path as string | undefined)?.trim()
        if (filePath) {
          const op: ChangedFile['operation'] =
            pending.name === 'write_file' && output.toLowerCase().includes('created') ? 'created' : 'modified'
          if (!sessionChangedFiles.find(f => f.path === filePath)) {
            sessionChangedFiles.push({ path: filePath, operation: op })
          }
        }
      }
      mainWindow.webContents.send(IPC.TOOL_CALL_RESULT, { conversationId, callId, output, isError } as ToolCallResultPayload)
    }
    const onToolOutputChunk = (callId: string, chunk: string) => {
      if (abort.signal.aborted) return
      mainWindow.webContents.send(IPC.TOOL_OUTPUT_CHUNK, { conversationId, callId, chunk } as ToolOutputChunkPayload)
    }

    // ── RAG: auto-inject relevant context ─────────────────────────────────────
    if (payload.settings.ragEnabled && payload.settings.workspacePath) {
      try {
        const lastUserMsg = [...payload.messages].reverse().find(m => m.role === 'user')?.content ?? ''
        if (lastUserMsg && lastUserMsg.length > 10) {
          // Extract keywords (remove common words, punctuation)
          const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','can','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','up','down','out','off','and','or','but','if','then','that','this','these','those','it','its','i','you','we','they','he','she','what','which','who','how','when','where','why'])
          const keywords = lastUserMsg
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w))
            .slice(0, 8)

          if (keywords.length > 0) {
            // Search BM25 index
            const searchResults = await (async () => {
              try {
                const { bm25Search } = await import('./semantic-search')
                return bm25Search(keywords.join(' '), payload.settings.workspacePath!, 3)
              } catch { /* no BM25 search available */ }
              return []
            })()

            if (searchResults.length > 0) {
              const ragBlock = searchResults.map(r =>
                `// ${r.path} (lines ${r.startLine}–${r.endLine})\n${r.excerpt}`
              ).join('\n\n---\n\n')
              settingsWithWorkspace = {
                ...settingsWithWorkspace,
                systemPrompt: settingsWithWorkspace.systemPrompt + `\n\n## Auto-retrieved context (RAG)\n\nRelevant code found in workspace:\n\`\`\`\n${ragBlock}\n\`\`\``
              }
              mainWindow.webContents.send(IPC.RAG_INJECTED, { chunks: searchResults.length })
            }
          }
        }
      } catch { /* silently ignore RAG errors — never break main chat */ }
    }

    // ── Mode-specific system prompt injection ─────────────────────────────────
    if (chatMode === 'agent') {
      const { AGENT_MODE_SYSTEM_PROMPT } = await import('./agent-system-prompt')
      settingsWithWorkspace = {
        ...settingsWithWorkspace,
        systemPrompt: settingsWithWorkspace.systemPrompt + AGENT_MODE_SYSTEM_PROMPT
      }
    } else if (chatMode === 'voice') {
      const { VOICE_MODE_SYSTEM_PROMPT } = await import('./voice-system-prompt')
      settingsWithWorkspace = {
        ...settingsWithWorkspace,
        systemPrompt: settingsWithWorkspace.systemPrompt + VOICE_MODE_SYSTEM_PROMPT
      }
    } else if (chatMode === 'review') {
      const { REVIEW_MODE_SYSTEM_PROMPT } = await import('./review-system-prompt')
      // Auto-inject git context so the AI starts with full knowledge of changes
      let gitContext = ''
      if (rawSettings.workspacePath && isGitRepo(rawSettings.workspacePath)) {
        try {
          const statusObj = getGitStatus(rawSettings.workspacePath)
          const statusStr = statusObj
            ? `Branch: ${statusObj.branch} | Staged: ${statusObj.staged.length} | Unstaged: ${statusObj.unstaged.length} | Untracked: ${statusObj.untracked.length}`
            : 'Unable to read status'
          const diff   = getGitDiff(rawSettings.workspacePath)
          const staged = getGitDiff(rawSettings.workspacePath, { staged: true })
          gitContext = `\n\n## Current Git State\n\n### Status\n\`\`\`\n${statusStr}\n\`\`\`\n\n### Unstaged Changes\n\`\`\`diff\n${diff}\n\`\`\`\n\n### Staged Changes\n\`\`\`diff\n${staged}\n\`\`\``
        } catch { /* git context is best-effort */ }
      }
      settingsWithWorkspace = {
        ...settingsWithWorkspace,
        systemPrompt: settingsWithWorkspace.systemPrompt + REVIEW_MODE_SYSTEM_PROMPT + gitContext
      }
    } else if (chatMode === 'pair') {
      const { PAIR_MODE_SYSTEM_PROMPT } = await import('./pair-system-prompt')
      settingsWithWorkspace = {
        ...settingsWithWorkspace,
        systemPrompt: settingsWithWorkspace.systemPrompt + PAIR_MODE_SYSTEM_PROMPT
      }
    }

    try {
      if (rawSettings.provider === 'anthropic') {
        await withRetry(() => runAnthropicAgentLoop(trimmedMessages, settingsWithWorkspace, {
          onTextChunk, onToolCallStart, onToolCallResult, onToolOutputChunk, onDiffRequest,
          abortSignal: abort.signal
        }), { maxRetries: 2, onRetry: (attempt, delay) => {
          onTextChunk(`\n\n⚠️ API error — retrying (attempt ${attempt}, waiting ${Math.round(delay/1000)}s)...\n\n`)
        }})
      } else if (rawSettings.provider === 'openai' || rawSettings.provider === 'custom' || rawSettings.provider === 'nvidia' || rawSettings.provider === 'openrouter') {
        await withRetry(() => runOpenAIAgentLoop(trimmedMessages, settingsWithWorkspace, {
          onTextChunk, onToolCallStart, onToolCallResult, onToolOutputChunk, onDiffRequest,
          abortSignal: abort.signal
        }), { maxRetries: 2, onRetry: (attempt, delay) => {
          onTextChunk(`\n\n⚠️ API error — retrying (attempt ${attempt}, waiting ${Math.round(delay/1000)}s)...\n\n`)
        }})
      } else if (rawSettings.provider === 'gemini') {
        await withRetry(() => runGeminiAgentLoop(trimmedMessages, settingsWithWorkspace, {
          onTextChunk, onToolCallStart, onToolCallResult, onToolOutputChunk, onDiffRequest,
          abortSignal: abort.signal
        }), { maxRetries: 2, onRetry: (attempt, delay) => {
          onTextChunk(`\n\n⚠️ API error — retrying (attempt ${attempt}, waiting ${Math.round(delay/1000)}s)...\n\n`)
        }})
      } else {
        // Fallback: plain streaming for any future providers
        const client = new AIClient(rawSettings)
        let fullText = ''
        for await (const chunk of client.streamMessage(trimmedMessages)) {
          if (abort.signal.aborted) break
          fullText += chunk
          onTextChunk(chunk)
        }
        if (!abort.signal.aborted) {
          mainWindow.webContents.send(IPC.STREAM_DONE, { conversationId, fullText } as StreamDonePayload)
          return
        }
      }

      if (!abort.signal.aborted) {
        // Finalize snapshot and emit session changes before STREAM_DONE
        let snapshotInfo: SnapshotInfo | null = null
        if (currentSnapshotId && rawSettings.workspacePath) {
          snapshotInfo = finalizeSnapshot(rawSettings.workspacePath, currentSnapshotId)
        }
        if (sessionChangedFiles.length > 0 || snapshotInfo) {
          mainWindow.webContents.send(IPC.SESSION_CHANGES, {
            conversationId,
            files:      sessionChangedFiles,
            snapshotId: snapshotInfo?.fileCount ? snapshotInfo.id : undefined
          } as SessionChangesPayload)
        }
        mainWindow.webContents.send(IPC.STREAM_DONE, { conversationId, fullText: '' } as StreamDonePayload)
        trackMessage(rawSettings.provider, rawSettings.model, chatMode)

        // ── Webhook: fire on completion ─────────────────────────────────────
        if (rawSettings.webhookEnabled && rawSettings.webhookUrl) {
          fireWebhook(rawSettings.webhookUrl, {
            event:          'complete',
            conversationId,
            provider:       rawSettings.provider,
            model:          rawSettings.model,
            timestamp:      new Date().toISOString()
          }).catch(() => { /* silent — never break main flow */ })
        }

        // ── Agent mode: badge + notification ────────────────────────────────
        if (chatMode === 'agent' && !mainWindow.isFocused()) {
          try {
            app.setBadgeCount(1)
            const { Notification: NativeNotification } = require('electron') as typeof import('electron')
            if (NativeNotification.isSupported()) {
              new NativeNotification({
                title: 'Agent Update',
                body:  'Agent completed a step. Check the app for progress.'
              }).show()
            }
          } catch { /* badge/notification errors are non-fatal */ }
        }
      }
    } catch (err: unknown) {
      if (abort.signal.aborted) return
      // Build a detailed log entry — capture OpenAI/Anthropic SDK-specific fields
      const errDetail: Record<string, unknown> = {
        message: err instanceof Error ? err.message : String(err),
        name:    err instanceof Error ? err.name    : typeof err,
      }
      if (err instanceof Error) {
        // OpenAI SDK: status, error (response body), code, type, param, request_id, headers
        // Anthropic SDK: status, error, request_id, headers
        for (const key of ['status', 'error', 'code', 'type', 'param', 'request_id'] as const) {
          const val = (err as Record<string, unknown>)[key]
          if (val !== undefined) {
            try { JSON.stringify(val); errDetail[key] = val } catch { errDetail[key] = String(val) }
          }
        }
        // Include headers as plain object (status/retry-after are useful for 429s)
        const hdrs = (err as Record<string, unknown>).headers
        if (hdrs && typeof hdrs === 'object') {
          try {
            // Headers may be a Headers instance or plain object
            const hdrObj = typeof (hdrs as { entries?: () => Iterable<[string, string]> }).entries === 'function'
              ? Object.fromEntries((hdrs as { entries: () => Iterable<[string, string]> }).entries())
              : JSON.parse(JSON.stringify(hdrs))
            // Only keep useful, non-sensitive headers
            const keep = ['retry-after', 'retry-after-ms', 'x-ratelimit-limit-requests',
                          'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests',
                          'x-request-id', 'cf-ray', 'content-type']
            const filtered = Object.fromEntries(Object.entries(hdrObj).filter(([k]) => keep.includes(k.toLowerCase())))
            if (Object.keys(filtered).length > 0) errDetail.headers = filtered
          } catch { /* skip headers if they can't be serialised */ }
        }
        errDetail.stack = err.stack
      }
      log.error('ipc', `chat:send error [${rawSettings.provider}/${rawSettings.model}]`, errDetail)
      const rawError = err instanceof Error ? err.message : String(err)
      const error = classifyApiError(rawError, rawSettings.model, rawSettings.provider)
      trackError(rawError)
      mainWindow.webContents.send(IPC.STREAM_ERROR, { conversationId, error } as StreamErrorPayload)

      // ── Webhook: fire on error ──────────────────────────────────────────────
      if (rawSettings.webhookEnabled && rawSettings.webhookUrl) {
        fireWebhook(rawSettings.webhookUrl, {
          event:          'error',
          conversationId,
          provider:       rawSettings.provider,
          model:          rawSettings.model,
          error,
          timestamp:      new Date().toISOString()
        }).catch(() => { /* silent */ })
      }
    } finally {
      activeStreams.delete(conversationId)
      setCmdApprovalFn(null)    // clear after turn so stale refs don't fire
    }
  })

  ipcMain.handle(IPC.CHAT_ABORT, (_event, conversationId: string) => {
    activeStreams.get(conversationId)?.abort.abort()
    activeStreams.delete(conversationId)
    return { ok: true }
  })

  // ── Diff approval ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.DIFF_RESPONSE, (_event, payload: DiffResponsePayload) => {
    const resolver = pendingDiffApprovals.get(payload.id)
    if (resolver) {
      resolver(payload.approved)
      pendingDiffApprovals.delete(payload.id)
    }
    return { ok: true }
  })

  // ── Title bar theme ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.SET_TITLEBAR_THEME, (_event, theme: 'dark' | 'light') => {
    if (theme === 'light') {
      mainWindow.setTitleBarOverlay({ color: '#ffffff', symbolColor: '#374151', height: 36 })
    } else {
      mainWindow.setTitleBarOverlay({ color: '#1a1a1a', symbolColor: '#ffffff', height: 36 })
    }
    return { ok: true }
  })

  // ── Export chat ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.EXPORT_CHAT, async (_event, payload: ExportChatPayload) => {
    const { defaultName, content, format } = payload
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${defaultName}.${format}`,
      filters: format === 'md'
        ? [{ name: 'Markdown', extensions: ['md'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'Text',     extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }]
    })
    if (!result.canceled && result.filePath) {
      writeFileSync(result.filePath, content, 'utf-8')
      return { ok: true }
    }
    return { ok: false }
  })

  // ── Git status (for UI status bar) ───────────────────────────────────────

  ipcMain.handle(IPC.GIT_STATUS_GET, (_event, workspacePath: string): GitStatusSummary => {
    if (!workspacePath || !isGitRepo(workspacePath)) {
      return { isRepo: false, branch: '', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, isClean: true }
    }
    const s = getGitStatus(workspacePath)
    if (!s) return { isRepo: true, branch: '?', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, isClean: true }
    return {
      isRepo:    true,
      branch:    s.branch,
      ahead:     s.ahead,
      behind:    s.behind,
      staged:    s.staged.length,
      unstaged:  s.unstaged.length,
      untracked: s.untracked.length,
      isClean:   s.isClean
    }
  })

  // ── Folder picker ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Workspace Folder'
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return { path: result.filePaths[0] }
    }
    return { path: null }
  })

  // ── OpenRouter model list ─────────────────────────────────────────────────
  // Fetches all available models from OpenRouter. Called on launch and when
  // the user switches to the openrouter provider. Requires an API key to get
  // the full list (including paid); public endpoint returns free models only.

  ipcMain.handle(IPC.OPENROUTER_GET_MODELS, async (_e, apiKey?: string) => {
    try {
      const headers: Record<string, string> = {
        'HTTP-Referer': 'https://aether-app',
        'X-Title':      'Aether'
      }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

      // Use Electron's net.fetch — works correctly from the main process
      const res = await net.fetch('https://openrouter.ai/api/v1/models', { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

      const json = await res.json() as {
        data: Array<{
          id:             string
          name:           string
          pricing:        { prompt: string; completion: string }
          context_length: number
        }>
      }

      if (!Array.isArray(json.data)) throw new Error('Unexpected response shape')

      const models = json.data
        .sort((a, b) => {
          const aFree = a.pricing?.prompt === '0'
          const bFree = b.pricing?.prompt === '0'
          if (aFree !== bFree) return aFree ? -1 : 1
          return a.id.localeCompare(b.id)
        })
        .map(m => ({
          id:            m.id,
          name:          m.name || m.id,
          contextLength: m.context_length ?? 0,
          isFree:        m.pricing?.prompt === '0',
          promptPrice:   m.pricing?.prompt ?? '',
        }))

      log.info('openrouter', `Fetched ${models.length} models`)
      return { ok: true, models }
    } catch (err) {
      log.warn('openrouter', 'Failed to fetch models', String(err))
      return { ok: false, models: [], error: String(err) }
    }
  })

  // ── Auto-updater ──────────────────────────────────────────────────────────

  // ── Terminal / PTY ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.TERMINAL_CREATE, (
    _event,
    workspacePath: string,
    cols: number,
    rows: number
  ) => {
    if (!PTY_AVAILABLE) return { sessionId: '', error: 'PTY not available' }
    return createTerminalSession(mainWindow, workspacePath, cols, rows)
  })

  ipcMain.handle(IPC.TERMINAL_WRITE, (_event, sessionId: string, data: string) => {
    writeTerminalSession(sessionId, data)
    return { ok: true }
  })

  ipcMain.handle(IPC.TERMINAL_RESIZE, (_event, sessionId: string, cols: number, rows: number) => {
    resizeTerminalSession(sessionId, cols, rows)
    return { ok: true }
  })

  ipcMain.handle(IPC.TERMINAL_KILL, (_event, sessionId: string) => {
    killTerminalSession(sessionId)
    return { ok: true }
  })

  ipcMain.handle(IPC.UPDATE_CHECK,    () => { checkForUpdates(); return { ok: true } })
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, () => { downloadUpdate();  return { ok: true } })
  ipcMain.handle(IPC.UPDATE_INSTALL,  () => { installUpdate();   return { ok: true } })

  // ── Semantic / BM25 index ─────────────────────────────────────────────────

  // Build BM25 index — runs synchronously in main (CPU-bound but fast enough)
  ipcMain.handle(IPC.SEMANTIC_INDEX_BUILD, (_event, workspacePath: string) => {
    if (!workspacePath) return { ok: false, error: 'No workspace path' }
    try {
      buildBM25(workspacePath, (done, total) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.SEMANTIC_INDEX_STATUS, {
            phase: 'indexing', done, total,
            message: `Indexing files… ${done} / ${total}`
          } as SemanticIndexStatusPayload)
        }
      })
      const info = getIndexInfo(workspacePath)
      mainWindow.webContents.send(IPC.SEMANTIC_INDEX_STATUS, {
        phase: 'done', done: info.chunkCount, total: info.chunkCount,
        message: `Done — ${info.chunkCount} chunks across ${info.fileCount} files`
      } as SemanticIndexStatusPayload)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      mainWindow.webContents.send(IPC.SEMANTIC_INDEX_STATUS, {
        phase: 'error', done: 0, total: 0, message
      } as SemanticIndexStatusPayload)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(IPC.SEMANTIC_INDEX_INFO, (_event, workspacePath: string) => {
    if (!workspacePath) return { exists: false, chunkCount: 0, fileCount: 0, createdAt: 0, hasEmbeddings: false }
    return getIndexInfo(workspacePath)
  })

  // Get workspace file contents — for the renderer embedding worker
  ipcMain.handle(IPC.SEMANTIC_GET_FILES, (_event, workspacePath: string) => {
    if (!workspacePath) return []
    return readWorkspaceFiles(workspacePath)
  })

  // Save dense embedding index — called by renderer after worker finishes
  ipcMain.handle(IPC.SEMANTIC_SAVE_EMBEDDINGS, (_event, payload: SaveEmbeddingsPayload) => {
    try {
      saveEmbeddingIndex(payload)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Vector search — renderer embeds the query, main does the cosine similarity
  ipcMain.handle(
    IPC.SEMANTIC_VECTOR_SEARCH,
    (_event, workspacePath: string, vector: number[], topK: number): SemanticSearchResult[] => {
      return vectorSearch(vector, workspacePath, topK)
    }
  )

  // ── Workspace file listing (for @-mention) ────────────────────────────────

  // Returns relative forward-slash paths of all text/code files in the workspace
  ipcMain.handle(IPC.WORKSPACE_LIST_FILES, (_event, workspacePath: string): string[] => {
    if (!workspacePath) return []
    try {
      const SKIP_DIRS = new Set([
        'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache',
        'coverage', '__pycache__', '.venv', 'venv', '.mypy_cache'
      ])
      const ALLOWED_EXTS = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
        '.py', '.rb', '.rs', '.go', '.java', '.kt', '.swift', '.cs',
        '.cpp', '.c', '.h', '.hpp', '.php',
        '.json', '.yaml', '.yml', '.toml', '.xml',
        '.html', '.css', '.scss', '.sass', '.less',
        '.sql', '.sh', '.bash', '.zsh', '.fish',
        '.md', '.mdx', '.txt', '.env', '.graphql', '.proto', '.prisma'
      ])
      const results: string[] = []

      function walk(dir: string, depth: number) {
        if (depth > 10) return
        let entries: string[]
        try { entries = readdirSync(dir) } catch { return }
        for (const entry of entries) {
          if (entry.startsWith('.') && entry !== '.env' && entry !== '.env.local') continue
          const fullPath = join(dir, entry)
          let stat
          try { stat = statSync(fullPath) } catch { continue }
          if (stat.isDirectory()) {
            if (!SKIP_DIRS.has(entry)) walk(fullPath, depth + 1)
          } else if (ALLOWED_EXTS.has(extname(entry).toLowerCase())) {
            results.push(relative(workspacePath, fullPath).replace(/\\/g, '/'))
          }
        }
      }

      walk(workspacePath, 0)
      return results.sort()
    } catch { return [] }
  })

  // ── Project memory ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.MEMORY_READ, (_event, workspacePath: string): { content: string } => {
    return { content: readProjectMemory(workspacePath) }
  })

  ipcMain.handle(IPC.MEMORY_WRITE, (_event, workspacePath: string, content: string): { ok: boolean; error?: string } => {
    if (!workspacePath) return { ok: false, error: 'No workspace path' }
    try {
      const absDir  = join(workspacePath, '.ai-memory')
      const absFile = join(workspacePath, MEMORY_FILE)
      if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true })
      writeFileSync(absFile, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Project summary ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.SUMMARY_READ, (_event, workspacePath: string): { content: string; updatedAt: number } => {
    if (!workspacePath) return { content: '', updatedAt: 0 }
    try {
      const absPath = join(workspacePath, SUMMARY_FILE)
      if (!existsSync(absPath)) return { content: '', updatedAt: 0 }
      const content   = readFileSync(absPath, 'utf-8')
      const updatedAt = statSync(absPath).mtimeMs
      return { content, updatedAt }
    } catch { return { content: '', updatedAt: 0 } }
  })

  ipcMain.handle(IPC.SUMMARY_WRITE, (_event, workspacePath: string, content: string): { ok: boolean; error?: string } => {
    if (!workspacePath) return { ok: false, error: 'No workspace path' }
    try {
      const absDir  = join(workspacePath, '.ai-context')
      const absFile = join(workspacePath, SUMMARY_FILE)
      if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true })
      writeFileSync(absFile, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Checkpoint restore ────────────────────────────────────────────────────

  ipcMain.handle(IPC.CHECKPOINT_RESTORE, (
    _event,
    workspace:  string,
    snapshotId: string
  ): { ok: boolean; restoredCount: number; error?: string } => {
    if (!workspace || !snapshotId) return { ok: false, restoredCount: 0, error: 'Missing parameters' }
    return restoreSnapshot(workspace, snapshotId)
  })

  // ── Global memory ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GLOBAL_MEMORY_READ, (): { content: string } => {
    const path = join(app.getPath('userData'), 'global-memory.md')
    try {
      const content = existsSync(path) ? readFileSync(path, 'utf-8') : ''
      return { content }
    } catch { return { content: '' } }
  })

  ipcMain.handle(IPC.GLOBAL_MEMORY_WRITE, (_event, content: string): { ok: boolean; error?: string } => {
    const path = join(app.getPath('userData'), 'global-memory.md')
    try {
      writeFileSync(path, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Shell command approval response ──────────────────────────────────────

  ipcMain.handle(IPC.CMD_APPROVAL_RESPONSE, (_event, id: string, approved: boolean) => {
    const resolver = pendingCmdApprovals.get(id)
    if (resolver) { resolver(approved); pendingCmdApprovals.delete(id) }
    return { ok: true }
  })

  // ── Kill a running shell command ──────────────────────────────────────────
  ipcMain.handle(IPC.KILL_COMMAND, (_event, callId: string) => {
    const killed = killRunningCommand(callId)
    return { ok: killed }
  })

  // ── Auto-title conversations ──────────────────────────────────────────────

  ipcMain.handle(IPC.CONV_AUTO_TITLE, async (_event, firstUserMsg: string, settings: AppSettings) => {
    const prompt =
      `Generate a short title (3-6 words, no quotes, no trailing punctuation) ` +
      `for a chat conversation that starts with:\n"${firstUserMsg.slice(0, 400)}"\n\nRespond with ONLY the title.`
    try {
      if (settings.provider === 'anthropic') {
        const { default: Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic({ apiKey: settings.apiKey, baseURL: settings.baseUrl || undefined })
        const resp   = await client.messages.create({
          model: settings.model, max_tokens: 25,
          messages: [{ role: 'user', content: prompt }]
        })
        const raw   = (resp.content[0] as { type: string; text?: string }).text ?? ''
        const title = raw.trim().replace(/^["']|["']$/g, '').replace(/[.!?]$/, '').slice(0, 60)
        return { ok: true, title }
      }
      if (settings.provider === 'openai' || settings.provider === 'custom') {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey: settings.apiKey, baseURL: settings.baseUrl || undefined })
        const resp   = await client.chat.completions.create({
          model: settings.model, max_tokens: 25,
          messages: [{ role: 'user', content: prompt }]
        })
        const raw   = resp.choices[0]?.message?.content ?? ''
        const title = raw.trim().replace(/^["']|["']$/g, '').replace(/[.!?]$/, '').slice(0, 60)
        return { ok: true, title }
      }
      return { ok: false, error: 'Auto-title not supported for this provider' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Pinned context files ──────────────────────────────────────────────────

  ipcMain.handle(IPC.PINS_READ, (_event, workspacePath: string): { pins: string[] } => {
    if (!workspacePath) return { pins: [] }
    try {
      const abs = join(workspacePath, PINS_FILE)
      if (!existsSync(abs)) return { pins: [] }
      return { pins: JSON.parse(readFileSync(abs, 'utf-8')) as string[] }
    } catch { return { pins: [] } }
  })

  ipcMain.handle(IPC.PINS_WRITE, (_event, workspacePath: string, pins: string[]): { ok: boolean; error?: string } => {
    if (!workspacePath) return { ok: false, error: 'No workspace path' }
    try {
      const absDir  = join(workspacePath, '.ai-context')
      const absFile = join(workspacePath, PINS_FILE)
      if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true })
      writeFileSync(absFile, JSON.stringify(pins, null, 2), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Per-project .chatui config ────────────────────────────────────────────

  ipcMain.handle(IPC.PROJECT_CONFIG_READ, (_event, workspacePath: string) => {
    return loadProjectConfig(workspacePath)
  })

  // ── Prompt library (stored in userData/prompt-library.json) ──────────────

  const promptLibraryPath = join(app.getPath('userData'), 'prompt-library.json')

  function readPromptLibrary(): import('../shared/types').SavedPrompt[] {
    try {
      if (!existsSync(promptLibraryPath)) return []
      return JSON.parse(readFileSync(promptLibraryPath, 'utf-8')) as import('../shared/types').SavedPrompt[]
    } catch { return [] }
  }

  function writePromptLibrary(prompts: import('../shared/types').SavedPrompt[]): void {
    writeFileSync(promptLibraryPath, JSON.stringify(prompts, null, 2), 'utf-8')
  }

  ipcMain.handle(IPC.PROMPT_LIST, () => {
    return readPromptLibrary()
  })

  ipcMain.handle(IPC.PROMPT_SAVE, (_event, prompt: import('../shared/types').SavedPrompt): { ok: boolean; error?: string } => {
    try {
      const prompts = readPromptLibrary()
      const idx = prompts.findIndex(p => p.id === prompt.id)
      if (idx >= 0) {
        prompts[idx] = { ...prompt, updatedAt: Date.now() }
      } else {
        prompts.unshift({ ...prompt, createdAt: Date.now(), updatedAt: Date.now() })
      }
      writePromptLibrary(prompts)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.PROMPT_DELETE, (_event, id: string): { ok: boolean; error?: string } => {
    try {
      const prompts = readPromptLibrary().filter(p => p.id !== id)
      writePromptLibrary(prompts)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Returns the text content of a single workspace file (bounded to workspace dir)
  ipcMain.handle(IPC.WORKSPACE_READ_FILE, (_event, workspacePath: string, relativePath: string): { content: string; error?: string } => {
    if (!workspacePath || !relativePath) return { content: '', error: 'Missing parameters' }
    try {
      const fullPath = join(workspacePath, relativePath)
      // Security: ensure resolved path stays inside workspace
      const resolvedWorkspace = join(workspacePath)
      const resolvedFull      = join(fullPath)
      if (!resolvedFull.startsWith(resolvedWorkspace)) {
        return { content: '', error: 'Path is outside workspace' }
      }
      const content = readFileSync(resolvedFull, 'utf-8')
      return { content }
    } catch (err) {
      return { content: '', error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Writes a file in the workspace (inline editor saves)
  ipcMain.handle(IPC.WORKSPACE_WRITE_FILE, (_event, workspacePath: string, relativePath: string, content: string): { ok: boolean; error?: string } => {
    if (!workspacePath || !relativePath) return { ok: false, error: 'Missing parameters' }
    try {
      const fullPath          = join(workspacePath, relativePath)
      const resolvedWorkspace = join(workspacePath)
      const resolvedFull      = join(fullPath)
      if (!resolvedFull.startsWith(resolvedWorkspace)) {
        return { ok: false, error: 'Path is outside workspace' }
      }
      const dir = join(resolvedFull, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(resolvedFull, content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Lists custom tool plugins from .ai-context/tools/*.js
  ipcMain.handle(IPC.PLUGINS_LIST, (_event, workspacePath: string): { name: string; description: string; file: string }[] => {
    if (!workspacePath) return []
    const pluginsDir = join(workspacePath, '.ai-context', 'tools')
    if (!existsSync(pluginsDir)) return []
    try {
      const files = readdirSync(pluginsDir).filter(f => f.endsWith('.js'))
      const result: { name: string; description: string; file: string }[] = []
      for (const file of files) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require(join(pluginsDir, file))
          if (mod?.name) {
            result.push({ name: mod.name, description: mod.description ?? '', file })
          }
        } catch { /* skip broken plugins */ }
      }
      return result
    } catch { return [] }
  })

  // ── Scheduled tasks ──────────────────────────────────────────────────────────
  const scheduledTasksPath = join(app.getPath('userData'), 'scheduled-tasks.json')

  function readScheduledTasks(): import('../shared/types').ScheduledTask[] {
    try {
      if (!existsSync(scheduledTasksPath)) return []
      return JSON.parse(readFileSync(scheduledTasksPath, 'utf-8'))
    } catch { return [] }
  }

  function writeScheduledTasks(tasks: import('../shared/types').ScheduledTask[]): void {
    writeFileSync(scheduledTasksPath, JSON.stringify(tasks, null, 2), 'utf-8')
  }

  ipcMain.handle(IPC.SCHEDULE_LIST, () => readScheduledTasks())

  ipcMain.handle(IPC.SCHEDULE_CREATE, (_event, task: Omit<import('../shared/types').ScheduledTask, 'id' | 'createdAt'>) => {
    try {
      const tasks = readScheduledTasks()
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
      const newTask: import('../shared/types').ScheduledTask = { ...task, id, createdAt: Date.now() }
      tasks.push(newTask)
      writeScheduledTasks(tasks)
      return { ok: true, id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.SCHEDULE_DELETE, (_event, id: string) => {
    try {
      writeScheduledTasks(readScheduledTasks().filter(t => t.id !== id))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.SCHEDULE_RUN, (_event, id: string) => {
    try {
      const tasks = readScheduledTasks()
      const task  = tasks.find(t => t.id === id)
      if (!task) return { ok: false, error: 'Task not found' }
      // Mark lastRun and fire the task via window event
      task.lastRun = Date.now()
      writeScheduledTasks(tasks)
      // Dispatch to renderer — send the prompt as a custom event
      mainWindow.webContents.send('schedule:fire', { taskId: id, prompt: task.prompt })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── GitHub integration ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GITHUB_DETECT_REPO, (_event, workspacePath: string) => {
    try {
      const remote = execSync('git remote get-url origin', { cwd: workspacePath, encoding: 'utf-8' }).trim()
      // Parse owner/repo from: https://github.com/owner/repo.git  OR  git@github.com:owner/repo.git
      const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/)
      if (!match) return null
      const [, owner, repo] = match
      let defaultBranch = 'main'
      try {
        defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: workspacePath, encoding: 'utf-8' })
          .trim().replace('refs/remotes/origin/', '')
      } catch { /* use 'main' */ }
      return { owner, repo, defaultBranch }
    } catch { return null }
  })

  // Helper for GitHub API calls
  function githubFetch(path: string, token: string, method = 'GET', body?: object): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    return new Promise((resolve) => {
      const https = require('https')
      const bodyStr = body ? JSON.stringify(body) : undefined
      const req = https.request({
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'AI-Code-App/1.0',
          ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {})
        }
      }, (res: import('http').IncomingMessage) => {
        let data = ''
        res.on('data', (chunk: Buffer) => data += chunk)
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (res.statusCode && res.statusCode >= 400) {
              resolve({ ok: false, error: parsed.message ?? `HTTP ${res.statusCode}` })
            } else {
              resolve({ ok: true, data: parsed })
            }
          } catch { resolve({ ok: false, error: 'Failed to parse response' }) }
        })
      })
      req.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }

  ipcMain.handle(IPC.GITHUB_LIST_PRS, async (_event, owner: string, repo: string, token: string) => {
    const result = await githubFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=20`, token)
    if (!result.ok) return []
    const prs = result.data as Array<Record<string, unknown>>
    return prs.map((pr) => ({
      number:    pr.number,
      title:     pr.title,
      state:     (pr.merged_at ? 'merged' : pr.state) as string,
      author:    (pr.user as { login: string }).login,
      branch:    (pr.head as { ref: string }).ref,
      url:       pr.html_url,
      createdAt: pr.created_at,
      body:      pr.body ?? ''
    }))
  })

  ipcMain.handle(IPC.GITHUB_CREATE_PR, async (_event, params: { owner: string; repo: string; title: string; body: string; head: string; base: string }, token: string) => {
    const result = await githubFetch(`/repos/${params.owner}/${params.repo}/pulls`, token, 'POST', {
      title: params.title, body: params.body, head: params.head, base: params.base
    })
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, url: (result.data as { html_url: string }).html_url }
  })

  ipcMain.handle(IPC.GITHUB_LIST_ISSUES, async (_event, owner: string, repo: string, token: string) => {
    const result = await githubFetch(`/repos/${owner}/${repo}/issues?state=open&per_page=20`, token)
    if (!result.ok) return []
    const issues = result.data as Array<Record<string, unknown>>
    return issues.filter((i) => !(i.pull_request)).map((issue) => ({
      number:    issue.number,
      title:     issue.title,
      state:     issue.state as string,
      author:    (issue.user as { login: string }).login,
      labels:    ((issue.labels as Array<{ name: string }>) ?? []).map((l) => l.name),
      url:       issue.html_url,
      createdAt: issue.created_at,
      body:      issue.body ?? ''
    }))
  })

  ipcMain.handle(IPC.GITHUB_CREATE_ISSUE, async (_event, params: { owner: string; repo: string; title: string; body: string; labels?: string[] }, token: string) => {
    const result = await githubFetch(`/repos/${params.owner}/${params.repo}/issues`, token, 'POST', {
      title: params.title, body: params.body, labels: params.labels ?? []
    })
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, url: (result.data as { html_url: string }).html_url }
  })

  // ── Code execution sandbox ────────────────────────────────────────────────────
  ipcMain.handle(IPC.CODE_EXEC, async (_event, language: string, code: string): Promise<{ ok: boolean; output: string; error?: string }> => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process')
      let cmd: string, args: string[]
      if (language === 'javascript' || language === 'js') {
        cmd = process.execPath  // run with Node.js itself (Electron's node)
        args = ['-e', code]
      } else if (language === 'python' || language === 'python3' || language === 'py') {
        cmd = 'python'
        args = ['-c', code]
      } else {
        resolve({ ok: false, output: '', error: `Language "${language}" is not supported for in-app execution. Supported: javascript, python.` })
        return
      }
      let output = ''
      let errOutput = ''
      const child = spawn(cmd, args, { timeout: 10000 })
      child.stdout.on('data', (d: Buffer) => output += d.toString())
      child.stderr.on('data', (d: Buffer) => errOutput += d.toString())
      child.on('close', (code: number) => {
        if (code !== 0 || errOutput) {
          resolve({ ok: false, output: output + errOutput, error: errOutput || `Exited with code ${code}` })
        } else {
          resolve({ ok: true, output })
        }
      })
      child.on('error', (e: Error) => {
        resolve({ ok: false, output: '', error: e.message })
      })
    })
  })

  // ── Agent presets ─────────────────────────────────────────────────────────────

  const presetsPath = () => join(app.getPath('userData'), 'agent-presets.json')

  function readPresets(): AgentPreset[] {
    try {
      if (!existsSync(presetsPath())) return []
      return JSON.parse(readFileSync(presetsPath(), 'utf-8')) as AgentPreset[]
    } catch { return [] }
  }

  function writePresets(presets: AgentPreset[]): void {
    writeFileSync(presetsPath(), JSON.stringify(presets, null, 2), 'utf-8')
  }

  ipcMain.handle(IPC.PRESET_LIST, () => readPresets())

  ipcMain.handle(IPC.PRESET_SAVE, (_event, preset: AgentPreset) => {
    try {
      const presets = readPresets().filter(p => p.id !== preset.id)
      presets.unshift(preset)
      writePresets(presets)
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e) } }
  })

  ipcMain.handle(IPC.PRESET_DELETE, (_event, id: string) => {
    try {
      writePresets(readPresets().filter(p => p.id !== id))
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e) } }
  })

  // ── Image generation ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.IMAGE_GEN, async (_event, prompt: string, settings: AppSettings): Promise<{ ok: boolean; url?: string; b64?: string; error?: string }> => {
    try {
      if (settings.provider !== 'openai' && settings.provider !== 'custom') {
        return { ok: false, error: 'Image generation requires OpenAI provider (DALL-E 3)' }
      }
      const OpenAI = require('openai').default ?? require('openai')
      const client = new OpenAI({
        apiKey:  settings.apiKey,
        baseURL: settings.baseUrl && !settings.baseUrl.includes('openai.com') ? settings.baseUrl : undefined
      })
      const response = await client.images.generate({
        model:           'dall-e-3',
        prompt,
        size:            '1024x1024',
        quality:         'standard',
        response_format: 'b64_json',
        n:               1
      })
      const b64 = response.data?.[0]?.b64_json
      if (!b64) return { ok: false, error: 'No image returned' }
      return { ok: true, b64 }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Local HTTP API server ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.API_SERVER_TOGGLE, (_event, enabled: boolean, port: number) => {
    if (enabled) {
      return startApiServer(port ?? 39400, getSettings)
    } else {
      return stopApiServer()
    }
  })

  ipcMain.handle(IPC.API_SERVER_STATUS, () => ({
    running: isApiServerRunning(),
    port:    getApiServerPort()
  }))

  // ── Ollama model detection ────────────────────────────────────────────────────

  ipcMain.handle(IPC.OLLAMA_LIST_MODELS, async () => {
    return new Promise<{ ok: boolean; models: string[] }>((resolve) => {
      const http = require('http') as typeof import('http')
      const req = http.get('http://localhost:11434/api/tags', { timeout: 3000 }, (res) => {
        let data = ''
        res.on('data', (c: Buffer) => { data += c.toString() })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { models?: Array<{ name: string }> }
            resolve({ ok: true, models: parsed.models?.map(m => m.name) ?? [] })
          } catch {
            resolve({ ok: false, models: [] })
          }
        })
      })
      req.on('error', () => resolve({ ok: false, models: [] }))
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, models: [] }) })
    })
  })

  // ── MCP servers ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.MCP_TEST_SERVER, async (_event, config: McpServerConfig) => {
    return startMcpServer(config)
  })

  ipcMain.handle(IPC.MCP_STOP_SERVER, (_event, id: string) => {
    stopMcpServer(id)
    return { ok: true }
  })

  ipcMain.handle(IPC.MCP_LIST_SERVERS, (_event, configs: McpServerConfig[]) => {
    return configs.map(c => ({
      ...c,
      status: getMcpServerStatus(c.id)
    }))
  })

  // ── Jira integration ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.JIRA_LIST_PROJECTS, async (_event, jiraUrl: string, email: string, token: string) => {
    const https = await import('https')
    const auth  = Buffer.from(`${email}:${token}`).toString('base64')
    return new Promise<{ ok: boolean; projects?: JiraProject[]; error?: string }>((resolve) => {
      const url = new URL('/rest/api/3/project/search?maxResults=50', jiraUrl)
      const req = https.request(
        { hostname: url.hostname, path: url.pathname + url.search, headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } },
        (res) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as { values?: Array<{ id: string; key: string; name: string }> }
              const projects: JiraProject[] = (parsed.values ?? []).map(p => ({ id: p.id, key: p.key, name: p.name }))
              resolve({ ok: true, projects })
            } catch { resolve({ ok: false, error: 'Failed to parse Jira response' }) }
          })
        }
      )
      req.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
      req.end()
    })
  })

  ipcMain.handle(IPC.JIRA_LIST_ISSUES, async (_event, jiraUrl: string, email: string, token: string, projectKey: string) => {
    const https = await import('https')
    const auth  = Buffer.from(`${email}:${token}`).toString('base64')
    return new Promise<{ ok: boolean; issues?: JiraIssue[]; error?: string }>((resolve) => {
      const jql  = encodeURIComponent(`project = ${projectKey} ORDER BY created DESC`)
      const url  = new URL(`/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,status,priority,assignee,issuetype,created`, jiraUrl)
      const req  = https.request(
        { hostname: url.hostname, path: url.pathname + url.search, headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } },
        (res) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as { issues?: Array<{ id: string; key: string; fields: { summary: string; status: { name: string }; priority: { name: string }; assignee: { displayName: string } | null; issuetype: { name: string }; created: string } }> }
              const issues: JiraIssue[] = (parsed.issues ?? []).map(i => ({
                id:        i.id,
                key:       i.key,
                summary:   i.fields.summary,
                status:    i.fields.status?.name ?? '',
                priority:  i.fields.priority?.name ?? '',
                assignee:  i.fields.assignee?.displayName ?? null,
                issueType: i.fields.issuetype?.name ?? '',
                created:   i.fields.created,
                url:       `${jiraUrl}/browse/${i.key}`
              }))
              resolve({ ok: true, issues })
            } catch { resolve({ ok: false, error: 'Failed to parse Jira response' }) }
          })
        }
      )
      req.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
      req.end()
    })
  })

  ipcMain.handle(IPC.JIRA_CREATE_ISSUE, async (_event, jiraUrl: string, email: string, token: string, params: { projectKey: string; summary: string; description: string; issueType: string }) => {
    const https = await import('https')
    const auth  = Buffer.from(`${email}:${token}`).toString('base64')
    const body  = JSON.stringify({
      fields: {
        project:     { key: params.projectKey },
        summary:     params.summary,
        description: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description || ' ' }] }] },
        issuetype:   { name: params.issueType || 'Task' }
      }
    })
    return new Promise<{ ok: boolean; key?: string; url?: string; error?: string }>((resolve) => {
      const url = new URL('/rest/api/3/issue', jiraUrl)
      const req = https.request(
        { hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as { key?: string; errors?: Record<string, string> }
              if (parsed.key) resolve({ ok: true, key: parsed.key, url: `${jiraUrl}/browse/${parsed.key}` })
              else resolve({ ok: false, error: JSON.stringify(parsed.errors ?? 'Unknown error') })
            } catch { resolve({ ok: false, error: 'Failed to parse Jira response' }) }
          })
        }
      )
      req.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
      req.write(body)
      req.end()
    })
  })

  // ── Linear integration ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LINEAR_LIST_ISSUES, async (_event, linearToken: string, teamId?: string) => {
    const https = await import('https')
    const query = JSON.stringify({
      query: `query {
        issues(first: 50${teamId ? `, filter: { team: { id: { eq: "${teamId}" } } }` : ''}, orderBy: createdAt) {
          nodes { id identifier title state { name } priority assignee { name } url createdAt }
        }
      }`
    })
    return new Promise<{ ok: boolean; issues?: LinearIssue[]; error?: string }>((resolve) => {
      const req = https.request(
        { hostname: 'api.linear.app', path: '/graphql', method: 'POST', headers: { 'Authorization': linearToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(query) } },
        (res) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as { data?: { issues?: { nodes?: Array<{ id: string; identifier: string; title: string; state: { name: string }; priority: number; assignee: { name: string } | null; url: string; createdAt: string }> } }; errors?: unknown[] }
              if (parsed.errors) { resolve({ ok: false, error: JSON.stringify(parsed.errors) }); return }
              const issues: LinearIssue[] = (parsed.data?.issues?.nodes ?? []).map(i => ({
                id:         i.id,
                identifier: i.identifier,
                title:      i.title,
                state:      i.state?.name ?? '',
                priority:   i.priority,
                assignee:   i.assignee?.name ?? null,
                url:        i.url,
                createdAt:  i.createdAt
              }))
              resolve({ ok: true, issues })
            } catch { resolve({ ok: false, error: 'Failed to parse Linear response' }) }
          })
        }
      )
      req.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
      req.write(query)
      req.end()
    })
  })

  ipcMain.handle(IPC.LINEAR_CREATE_ISSUE, async (_event, linearToken: string, params: { teamId: string; title: string; description: string; priority?: number }) => {
    const https = await import('https')
    const mutation = JSON.stringify({
      query: `mutation CreateIssue($teamId: String!, $title: String!, $description: String, $priority: Int) {
        issueCreate(input: { teamId: $teamId, title: $title, description: $description, priority: $priority }) {
          success
          issue { identifier url }
        }
      }`,
      variables: { teamId: params.teamId, title: params.title, description: params.description || '', priority: params.priority ?? 0 }
    })
    return new Promise<{ ok: boolean; identifier?: string; url?: string; error?: string }>((resolve) => {
      const req = https.request(
        { hostname: 'api.linear.app', path: '/graphql', method: 'POST', headers: { 'Authorization': linearToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(mutation) } },
        (res) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as { data?: { issueCreate?: { success: boolean; issue?: { identifier: string; url: string } } }; errors?: unknown[] }
              if (parsed.errors) { resolve({ ok: false, error: JSON.stringify(parsed.errors) }); return }
              const result = parsed.data?.issueCreate
              if (result?.success && result.issue) resolve({ ok: true, identifier: result.issue.identifier, url: result.issue.url })
              else resolve({ ok: false, error: 'Issue creation failed' })
            } catch { resolve({ ok: false, error: 'Failed to parse Linear response' }) }
          })
        }
      )
      req.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
      req.write(mutation)
      req.end()
    })
  })

  // ── Conversation import ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.CONV_IMPORT, async (_event, filePath: string) => {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

      // Try to parse several common markdown export formats
      // Format 1: ## User / ## Assistant headings
      const headingPattern = /^#{1,3}\s+(User|Human|Assistant|AI|System)\s*$/gim
      const parts = content.split(headingPattern).map(s => s.trim()).filter(Boolean)
      if (parts.length >= 2 && /^(User|Human|Assistant|AI|System)$/i.test(parts[0])) {
        for (let i = 0; i + 1 < parts.length; i += 2) {
          const roleRaw = parts[i].toLowerCase()
          const msgContent = parts[i + 1]
          const role: 'user' | 'assistant' = roleRaw === 'user' || roleRaw === 'human' ? 'user' : 'assistant'
          if (msgContent) messages.push({ role, content: msgContent })
        }
      } else {
        // Format 2: **User:** / **Assistant:** bold labels
        const boldPattern = /\*\*(User|Human|Assistant|AI):\*\*\s*/gi
        const boldParts = content.split(boldPattern).map(s => s.trim()).filter(Boolean)
        if (boldParts.length >= 2 && /^(User|Human|Assistant|AI)$/i.test(boldParts[0])) {
          for (let i = 0; i + 1 < boldParts.length; i += 2) {
            const roleRaw = boldParts[i].toLowerCase()
            const msgContent = boldParts[i + 1]
            const role: 'user' | 'assistant' = roleRaw === 'user' || roleRaw === 'human' ? 'user' : 'assistant'
            if (msgContent) messages.push({ role, content: msgContent })
          }
        } else {
          // Format 3: treat entire file as a single user message
          messages.push({ role: 'user', content: content.slice(0, 20_000) })
        }
      }

      if (messages.length === 0) {
        return { ok: false, error: 'Could not parse any messages from the file' }
      }

      // Build a Conversation object
      const fileName = require('path').basename(filePath, require('path').extname(filePath))
      const settings = getSettings()
      const conv: Conversation = {
        id:        `imported-${Date.now()}`,
        title:     fileName || 'Imported conversation',
        messages:  messages.map((m, idx) => ({
          id:        `msg-${idx}`,
          role:      m.role,
          content:   m.content,
          timestamp: Date.now() - (messages.length - idx) * 1000
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provider:  settings.provider,
        model:     settings.model
      }

      return { ok: true, conversation: conv }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Webhook test ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.WEBHOOK_TEST, async (_event, webhookUrl: string) => {
    try {
      const https = await import('https')
      const http  = await import('http')
      const body  = JSON.stringify({ event: 'test', message: 'Test webhook from AI Code App', timestamp: new Date().toISOString() })
      const url   = new URL(webhookUrl)
      const lib   = url.protocol === 'https:' ? https : http
      return await new Promise<{ ok: boolean; status?: number; error?: string }>((resolve) => {
        const req = lib.request(
          { hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
          (res) => { resolve({ ok: true, status: res.statusCode }) }
        )
        req.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
        req.write(body)
        req.end()
      })
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Voice transcription (Whisper API) ─────────────────────────────────────

  ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_event, audioBase64: string, settings: AppSettings): Promise<{ ok: boolean; text?: string; error?: string }> => {
    try {
      if (!settings.apiKey) return { ok: false, error: 'No API key configured' }

      // Use OpenAI Whisper API for transcription
      const OpenAI = (await import('openai')).default
      const client = new OpenAI({
        apiKey:  settings.apiKey,
        baseURL: settings.provider === 'openai' || settings.provider === 'custom'
          ? (settings.baseUrl?.includes('openai.com') ? undefined : settings.baseUrl)
          : undefined
      })

      // Convert base64 to a File-like object for the API
      const audioBuffer = Buffer.from(audioBase64, 'base64')
      const audioFile   = new File([audioBuffer], 'recording.webm', { type: 'audio/webm' })

      const transcription = await client.audio.transcriptions.create({
        file:  audioFile,
        model: 'whisper-1'
      })

      return { ok: true, text: transcription.text }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IPC.VOICE_TTS, async (_event, text: string, settings: AppSettings): Promise<{ ok: boolean; audioBase64?: string; error?: string }> => {
    try {
      if (!settings.apiKey) return { ok: false, error: 'No API key configured' }

      const OpenAI = (await import('openai')).default
      const client = new OpenAI({
        apiKey:  settings.apiKey,
        baseURL: settings.provider === 'openai' || settings.provider === 'custom'
          ? (settings.baseUrl?.includes('openai.com') ? undefined : settings.baseUrl)
          : undefined
      })

      const response = await client.audio.speech.create({
        model:           'tts-1',
        voice:           'nova',
        input:           text.slice(0, 4096),
        response_format: 'mp3'
      })

      const arrayBuffer = await response.arrayBuffer()
      const base64      = Buffer.from(arrayBuffer).toString('base64')
      return { ok: true, audioBase64: base64 }
    } catch (e) {
      // Fallback: use browser SpeechSynthesis (handled by renderer)
      return { ok: false, error: String(e) }
    }
  })

  // ── File watcher (Pair mode) ──────────────────────────────────────────────

  ipcMain.handle(IPC.FILE_WATCH_START, async (_event, workspacePath: string) => {
    const { startFileWatcher } = await import('./file-watcher')
    return startFileWatcher(workspacePath, mainWindow)
  })

  ipcMain.handle(IPC.FILE_WATCH_STOP, async () => {
    const { stopFileWatcher } = await import('./file-watcher')
    stopFileWatcher()
    return { ok: true }
  })

  // ── Review mode: get current changes ──────────────────────────────────────

  ipcMain.handle(IPC.REVIEW_GET_CHANGES, async (_event, workspacePath: string) => {
    try {
      if (!workspacePath || !isGitRepo(workspacePath)) {
        return { ok: false, error: 'Not a git repository' }
      }
      const statusObj = getGitStatus(workspacePath)
      const status    = statusObj
        ? `Branch: ${statusObj.branch} | Staged: ${statusObj.staged.length} | Unstaged: ${statusObj.unstaged.length} | Untracked: ${statusObj.untracked.length}`
        : ''
      const diff      = getGitDiff(workspacePath)
      const staged    = getGitDiff(workspacePath, { staged: true })
      return { ok: true, status, diff, staged }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Settings export / import ──────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_EXPORT, async () => {
    try {
      const settings = getSettings()
      const json = JSON.stringify(settings, null, 2)
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Settings',
        defaultPath: `chatui-settings-${new Date().toISOString().slice(0,10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false }
      writeFileSync(result.filePath, json, 'utf-8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IPC.SETTINGS_IMPORT, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import Settings',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false }
      const raw = readFileSync(result.filePaths[0], 'utf-8')
      const imported = JSON.parse(raw) as AppSettings
      // Basic validation — must have provider field
      if (!imported || typeof imported.provider !== 'string') {
        return { ok: false, error: 'Invalid settings file' }
      }
      await saveSettings(imported)
      return { ok: true, settings: imported }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Conversation backup / restore ─────────────────────────────────────────

  ipcMain.handle(IPC.CONV_EXPORT_ALL, async () => {
    try {
      const conversations = getConversations()
      const json = JSON.stringify({ version: 1, exportedAt: Date.now(), conversations }, null, 2)
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Backup Conversations',
        defaultPath: `chatui-conversations-${new Date().toISOString().slice(0,10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false }
      writeFileSync(result.filePath, json, 'utf-8')
      return { ok: true, count: conversations.length }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle(IPC.CONV_IMPORT_ALL, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Restore Conversations',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
      })
      if (result.canceled || !result.filePaths[0]) return { ok: false }
      const raw  = readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(raw) as { version?: number; conversations?: Conversation[] }
      const convs: Conversation[] = data.conversations ?? (Array.isArray(data) ? data as Conversation[] : [])
      if (!Array.isArray(convs)) return { ok: false, error: 'Invalid backup file' }
      let imported = 0
      for (const conv of convs) {
        if (conv?.id && conv?.messages) {
          saveConversation(conv)
          imported++
        }
      }
      return { ok: true, count: imported }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // ── Optional dependency check ─────────────────────────────────────────────

  ipcMain.handle(IPC.CHECK_OPTIONAL_DEPS, async (): Promise<{
    playwright:    { available: boolean; version?: string }
    betterSqlite: { available: boolean; version?: string }
    pg:           { available: boolean; version?: string }
  }> => {
    const check = async (pkg: string): Promise<{ available: boolean; version?: string }> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(pkg)
        const version = mod?.default?.VERSION ?? mod?.VERSION ?? undefined
        return { available: true, version }
      } catch {
        return { available: false }
      }
    }
    const [playwright, betterSqlite, pg] = await Promise.all([
      check('playwright'),
      check('better-sqlite3'),
      check('pg')
    ])
    return { playwright, betterSqlite, pg }
  })

  // ── Log viewer ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOG_GET_PATH, () => {
    return log.getLogPath()
  })

  ipcMain.handle(IPC.LOG_READ, async (_e, lines: number = 500) => {
    const { readFileSync, existsSync } = await import('fs')
    try {
      const filePath = log.getLogPath()
      if (!existsSync(filePath)) return { ok: true, entries: [] }
      const raw = readFileSync(filePath, 'utf-8')
      const allLines = raw.split('\n').filter(l => l.trim())
      const tail = allLines.slice(-Math.max(lines, 1))
      const entries = tail.map(line => {
        try { return JSON.parse(line) } catch { return { ts: '', level: 'INFO', tag: 'raw', msg: line } }
      })
      return { ok: true, entries }
    } catch (err) {
      return { ok: false, entries: [], error: String(err) }
    }
  })
}
