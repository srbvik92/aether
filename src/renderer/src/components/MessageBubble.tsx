import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ChatMessage, AppSettings, ToolCallDisplay, ChangedFile } from '../../../shared/types'
import InlineDiffViewer from './InlineDiffViewer'

interface Props {
  message:          ChatMessage
  settings:         AppSettings
  isLastAI?:        boolean    // show Regenerate button on last AI message
  chatStreaming?:    boolean    // disable actions while anything is streaming
  onEdit?:          (id: string, newContent: string) => void
  onRegenerate?:    (id: string) => void
  onBranch?:        (id: string) => void
  onRate?:          (id: string, rating: 'up' | 'down') => void
  onOpenFile?:      (path: string) => void
  onOpenSettings?:  () => void  // for "Change model" action on model errors
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text, light }: { text: string; light?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        light
          ? 'text-blue-200 hover:text-white hover:bg-white/20'
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/10'
      }`}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className={light ? 'text-green-300' : 'text-green-400'}>Copied</span>
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </button>
  )
}

// ── Collapsible URL fetch card ────────────────────────────────────────────────
function UrlFetchCard({ url, content }: { url: string; content: string }) {
  const [open, setOpen] = useState(false)
  const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
  return (
    <div className="rounded-xl border border-white/20 bg-white/10 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/10 transition-colors"
      >
        <svg className="w-3.5 h-3.5 shrink-0 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        <span className="truncate text-blue-100 flex-1">{hostname}</span>
        <span className="text-blue-200/60 shrink-0">Fetched page · {open ? 'hide' : 'show'}</span>
        <svg className={`w-3.5 h-3.5 shrink-0 text-blue-200 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-white/10 px-3 py-2 max-h-48 overflow-y-auto">
          <a href={url} target="_blank" rel="noreferrer" className="text-blue-300 hover:underline break-all block mb-2">{url}</a>
          <p className="text-blue-100/80 whitespace-pre-wrap leading-relaxed">{content.slice(0, 2000)}{content.length > 2000 ? '\n…' : ''}</p>
        </div>
      )}
    </div>
  )
}

// ── Code block ────────────────────────────────────────────────────────────────
const SHELL_LANGS    = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'powershell', 'ps1', 'cmd', 'bat', 'console'])
const SANDBOX_LANGS  = new Set(['javascript', 'js', 'python', 'python3', 'py'])

type ExecState = 'idle' | 'running' | 'done' | 'error'

function CodeBlock({ language, code, isDark }: { language: string; code: string; isDark: boolean }) {
  const displayLang = language || 'text'
  const isShell     = SHELL_LANGS.has(displayLang.toLowerCase())
  const isSandbox   = SANDBOX_LANGS.has(displayLang.toLowerCase())
  const isElectronCtx = typeof window !== 'undefined' && !!window.api

  const [execState,  setExecState]  = useState<ExecState>('idle')
  const [execOutput, setExecOutput] = useState<string>('')
  const [showOutput, setShowOutput] = useState(false)

  const runInTerminal = () => {
    window.dispatchEvent(new CustomEvent('run-in-terminal', { detail: { code } }))
  }

  const runInSandbox = async () => {
    if (!isElectronCtx) return
    setExecState('running')
    setExecOutput('')
    setShowOutput(true)
    try {
      const result = await window.api.execCode(displayLang, code)
      setExecOutput(result.output || result.error || '(no output)')
      setExecState(result.ok ? 'done' : 'error')
    } catch (err) {
      setExecOutput(err instanceof Error ? err.message : String(err))
      setExecState('error')
    }
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 text-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 dark:bg-gray-900 border-b border-gray-700">
        <span className="text-xs font-mono text-gray-400">{displayLang}</span>
        <div className="flex items-center gap-1">
          {isShell && (
            <button
              onClick={runInTerminal}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-green-400 hover:bg-white/10 transition-colors"
              title="Run in terminal"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
              </svg>
              Run
            </button>
          )}
          {isSandbox && isElectronCtx && (
            <button
              onClick={runInSandbox}
              disabled={execState === 'running'}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                execState === 'running'   ? 'text-blue-400 cursor-wait' :
                execState === 'done'      ? 'text-green-400 hover:bg-white/10' :
                execState === 'error'     ? 'text-red-400 hover:bg-white/10' :
                                            'text-gray-400 hover:text-blue-400 hover:bg-white/10'
              }`}
              title="Run in sandbox (JavaScript or Python)"
            >
              {execState === 'running' ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              )}
              {execState === 'idle' ? 'Run' : execState === 'running' ? 'Running…' : execState === 'done' ? '✓ Done' : '✕ Error'}
            </button>
          )}
          {showOutput && (
            <button
              onClick={() => setShowOutput(v => !v)}
              className="text-xs text-gray-500 hover:text-gray-300 px-1 transition-colors"
              title="Toggle output"
            >
              {showOutput ? '▲' : '▼'} Output
            </button>
          )}
          <CopyButton text={code} />
        </div>
      </div>
      <SyntaxHighlighter
        language={displayLang}
        style={isDark ? oneDark : oneLight}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8125rem', lineHeight: '1.6', padding: '1rem', background: isDark ? '#1e1e2e' : '#fafafa' }}
        showLineNumbers={code.split('\n').length > 5}
        lineNumberStyle={{ color: isDark ? '#4a4a6a' : '#bbb', minWidth: '2.5em' }}
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
      {/* Execution output panel */}
      {showOutput && execOutput && (
        <div className={`border-t border-gray-700 px-4 py-3 ${execState === 'error' ? 'bg-red-950/40' : 'bg-gray-950'}`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${execState === 'error' ? 'text-red-400' : 'text-green-400'}`}>
              {execState === 'error' ? '✕ Error' : '✓ Output'}
            </span>
            <button onClick={() => { setExecState('idle'); setShowOutput(false); setExecOutput('') }}
              className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">Clear</button>
          </div>
          <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">{execOutput}</pre>
        </div>
      )}
    </div>
  )
}

// ── Tool icon by name ─────────────────────────────────────────────────────────
export function toolIcon(name: string): string {
  switch (name) {
    case 'read_file':             return '📄'
    case 'read_file_range':       return '📄'
    case 'write_file':            return '✏️'
    case 'str_replace':           return '✏️'
    case 'list_directory':        return '📁'
    case 'search_files':          return '🔍'
    case 'run_command':           return '⚡'
    case 'run_docker':            return '🐳'
    case 'git_status':            return '🌿'
    case 'git_diff':              return '↕️'
    case 'git_log':               return '📜'
    case 'git_add':               return '➕'
    case 'git_commit':            return '💾'
    case 'semantic_search':       return '🧠'
    case 'remember':              return '🧠'
    case 'remember_globally':     return '🧠'
    case 'write_plan':            return '📋'
    case 'update_project_summary':return '📋'
    case 'fetch_url':             return '🌐'
    case 'web_search':            return '🔎'
    case 'query_database':        return '🗄️'
    case 'browser_navigate':      return '🌐'
    case 'browser_screenshot':    return '📸'
    case 'browser_click':         return '🖱️'
    case 'browser_fill':          return '⌨️'
    default:                      return '🔧'
  }
}

export function toolLabel(name: string): string {
  switch (name) {
    case 'read_file':             return 'Reading file'
    case 'read_file_range':       return 'Reading file'
    case 'write_file':            return 'Writing file'
    case 'str_replace':           return 'Editing file'
    case 'list_directory':        return 'Listing directory'
    case 'search_files':          return 'Searching files'
    case 'run_command':           return 'Running command'
    case 'run_docker':            return 'Running in Docker'
    case 'git_status':            return 'Checking git status'
    case 'git_diff':              return 'Checking git diff'
    case 'git_log':               return 'Checking git log'
    case 'git_add':               return 'Staging files'
    case 'git_commit':            return 'Committing'
    case 'semantic_search':       return 'Searching codebase'
    case 'remember':              return 'Saving to memory'
    case 'remember_globally':     return 'Saving to memory'
    case 'write_plan':            return 'Writing plan'
    case 'update_project_summary':return 'Updating summary'
    case 'fetch_url':             return 'Fetching URL'
    case 'web_search':            return 'Searching web'
    case 'query_database':        return 'Querying database'
    case 'browser_navigate':      return 'Navigating browser'
    case 'browser_screenshot':    return 'Taking screenshot'
    case 'browser_click':         return 'Clicking'
    case 'browser_fill':          return 'Filling form'
    default:                      return name.replace(/_/g, ' ')
  }
}

// ── Tool call card ────────────────────────────────────────────────────────────
function ToolCallCard({ call }: { call: ToolCallDisplay }) {
  const isShellLike = ['run_command', 'run_docker'].includes(call.name)
  // Shell commands start expanded so the terminal is always visible
  const [expanded, setExpanded] = useState(isShellLike)
  const liveRef = useRef<HTMLPreElement>(null)

  // Auto-scroll terminal to bottom as new chunks arrive
  useEffect(() => {
    if (liveRef.current) {
      liveRef.current.scrollTop = liveRef.current.scrollHeight
    }
  }, [call.liveOutput, call.output])

  const inputPath = call.input.path ?? call.input.file ?? call.input.filename ?? call.input.filepath ?? call.input.file_path
  const inputCmd  = call.input.command ?? call.input.cmd ?? call.input.run ?? call.input.script
  const subtitle = inputPath
    ? String(inputPath)
    : inputCmd
      ? String(inputCmd)
      : call.input.pattern
        ? `"${call.input.pattern}"`
        : call.input.query
          ? `"${call.input.query}"`
          : call.input.message
            ? String(call.input.message)
            : call.input.paths
              ? (call.input.paths as string[]).join(', ')
              : call.input.staged !== undefined
                ? (call.input.staged ? 'staged' : 'unstaged')
                : null

  const isRunning  = call.status === 'running'
  const isAwaiting = call.status === 'awaiting-approval'
  const isError    = call.status === 'error' || call.isError
  const isStopped  = call.status === 'stopped'
  const isDone     = call.status === 'done'
  const hasLive    = isRunning   // always show terminal pane when running
  const isShellCmd = ['run_command', 'run_docker'].includes(call.name)
  // Shell cmds: always expandable when done (show terminal); others: only when there's output
  const canExpand  = !isRunning && !isAwaiting && (isShellCmd ? isDone || isError : !!call.output)

  return (
    <div className={`my-2 rounded-xl border text-xs overflow-hidden transition-colors ${
      isError    ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20' :
      isStopped  ? 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50' :
      isAwaiting ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20' :
      isRunning  ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20' :
                   'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'
    }`}>
      {/* Header row */}
      <div
        className={`flex items-center gap-2 px-3 py-2 select-none ${canExpand ? 'cursor-pointer' : ''}`}
        onClick={() => canExpand && setExpanded(e => !e)}
      >
        <span>{toolIcon(call.name)}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">{toolLabel(call.name)}</span>
        {subtitle && (
          <span className="font-mono text-gray-400 dark:text-gray-500 truncate max-w-[260px]">{subtitle}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {isAwaiting && !call.diffPayload ? (
            <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 font-medium">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Awaiting your approval
            </span>
          ) : isRunning ? (
            <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Running…
            </span>
          ) : isStopped ? (
            <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
              </svg>
              Stopped
            </span>
          ) : isError ? (
            <span className="text-red-500 dark:text-red-400">✕ Error</span>
          ) : (
            <span className="text-green-600 dark:text-green-400">✓ Done</span>
          )}
          {/* Stop button — kills running process OR rejects pending approval */}
          {(isRunning || isAwaiting) && isShellCmd && typeof window !== 'undefined' && window.api && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (isAwaiting && call.approvalId) {
                  window.api.respondCmdApproval(call.approvalId, false)
                } else {
                  window.api.killCommand(call.id)
                }
              }}
              title={isAwaiting ? 'Reject this command' : 'Stop this command'}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/60 border border-red-200 dark:border-red-700 transition-colors"
            >
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="16" rx="2"/>
              </svg>
              {isAwaiting ? 'Reject' : 'Stop'}
            </button>
          )}
          {/* Approve button — shown when awaiting approval */}
          {isAwaiting && call.approvalId && typeof window !== 'undefined' && window.api && (
            <button
              onClick={(e) => { e.stopPropagation(); window.api.respondCmdApproval(call.approvalId!, true) }}
              title="Approve and run this command"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/60 border border-green-200 dark:border-green-700 transition-colors"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Approve
            </button>
          )}
          {canExpand && (
            <svg
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </div>

      {/* Inline diff — shown when this tool call has a pending diff approval */}
      {call.diffPayload && call.diffId && isAwaiting && (
        <div className="px-3 pb-3">
          <InlineDiffViewer
            payload={call.diffPayload}
            diffId={call.diffId}
            onApprove={(content) => {
              if (typeof window !== 'undefined' && window.api) {
                window.api.respondDiff({ id: call.diffId!, approved: true, content })
              }
            }}
            onReject={() => {
              if (typeof window !== 'undefined' && window.api) {
                window.api.respondDiff({ id: call.diffId!, approved: false })
              }
            }}
          />
        </div>
      )}

      {/* ── Mini terminal — shown for shell commands while running or after completion ── */}
      {isShellCmd && (hasLive || (canExpand && expanded)) && (
        <div className="border-t border-gray-700/60 rounded-b-xl overflow-hidden">
          {/* Terminal title bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1a1a] border-b border-gray-700/60">
            <div className="flex items-center gap-1.5">
              {/* macOS-style traffic lights */}
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
            </div>
            <span className="text-[10px] text-gray-500 font-mono truncate max-w-[60%]" title={String(call.input.command ?? '')}>
              {String(call.input.command ?? 'shell').slice(0, 60)}
            </span>
            <CopyButton text={call.liveOutput ?? call.output ?? ''} />
          </div>

          {/* Terminal body */}
          <pre
            ref={liveRef}
            className="px-3 py-2.5 text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto bg-[#1e1e1e] text-gray-200 scrollbar-thin"
            style={{ scrollbarColor: '#444 #1e1e1e' }}
          >
            {/* Prompt line — PS> on Windows, $ elsewhere */}
            <span className="text-green-400 select-none">
              {typeof window !== 'undefined' && window.api?.platform === 'win32' ? 'PS> ' : '$ '}
            </span>
            <span className="text-gray-300">{String(call.input.command ?? '')}</span>
            {'\n'}

            {/* Output or waiting state */}
            {(call.liveOutput ?? call.output) ? (
              <>
                {call.liveOutput ?? call.output}
                {hasLive && (
                  <span className="inline-block w-[7px] h-[13px] bg-gray-400 ml-0.5 animate-pulse align-middle" />
                )}
              </>
            ) : hasLive ? (
              <span className="text-gray-500 italic">waiting for output…</span>
            ) : null}
          </pre>
        </div>
      )}

      {/* ── Collapsible output for non-shell tools ── */}
      {!isShellCmd && expanded && call.output && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between px-3 py-1 bg-gray-100 dark:bg-gray-900/50">
            <span className="text-gray-400">Output</span>
            <CopyButton text={call.output} />
          </div>
          <pre className="px-3 py-2 overflow-x-auto text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
            {call.output}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Undo session button ───────────────────────────────────────────────────────
function UndoSessionButton({
  snapshotId,
  workspacePath,
  fileCount
}: {
  snapshotId:    string
  workspacePath: string
  fileCount:     number
}) {
  const [phase,   setPhase]   = useState<'idle' | 'confirm' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleUndo = async () => {
    setPhase('working')
    try {
      const result = await window.api.restoreSnapshot(workspacePath, snapshotId)
      if (result.ok) {
        setPhase('done')
        setMessage(`Restored ${result.restoredCount} file${result.restoredCount !== 1 ? 's' : ''} to their original state.`)
      } else {
        setPhase('error')
        setMessage(result.error ?? 'Restore failed')
      }
    } catch (err) {
      setPhase('error')
      setMessage(err instanceof Error ? err.message : 'Restore failed')
    }
  }

  if (phase === 'done') {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 px-1">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        {message}
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="mt-1.5 text-xs text-red-500 dark:text-red-400 px-1">
        ✕ {message}
      </div>
    )
  }

  if (phase === 'confirm') {
    return (
      <div className="mt-1.5 flex items-center gap-2 px-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Restore {fileCount} file{fileCount !== 1 ? 's' : ''} to pre-session state?
        </span>
        <button
          onClick={handleUndo}
          className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
        >
          Yes, undo
        </button>
        <button
          onClick={() => setPhase('idle')}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setPhase('confirm')}
      disabled={phase === 'working'}
      className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-orange-500 dark:hover:text-orange-400
                 transition-colors px-1 py-0.5 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50"
    >
      <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
      </svg>
      {phase === 'working' ? 'Restoring…' : 'Undo session changes'}
    </button>
  )
}

// ── Session change summary bar ────────────────────────────────────────────────
function ChangedFilesBar({ files, onOpenFile }: { files: ChangedFile[]; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!files.length) return null

  const created  = files.filter(f => f.operation === 'created').length
  const modified = files.filter(f => f.operation === 'modified').length

  const summary = [
    created  > 0 ? `${created} created`  : '',
    modified > 0 ? `${modified} modified` : ''
  ].filter(Boolean).join(', ')

  return (
    <div className="mt-2 rounded-lg border border-green-200 dark:border-green-800 overflow-hidden text-xs">
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20
                   text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30
                   transition-colors text-left"
      >
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-medium">Changed {files.length} file{files.length !== 1 ? 's' : ''}</span>
        <span className="text-green-500 dark:text-green-500 font-normal">— {summary}</span>
        <svg
          className={`w-3 h-3 ml-auto flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {/* File list — collapsible */}
      {open && (
        <div className="divide-y divide-green-100 dark:divide-green-900/40">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1 bg-white dark:bg-gray-900 group/file">
              <span className={`flex-shrink-0 w-14 text-[10px] font-medium uppercase tracking-wide
                ${f.operation === 'created'
                  ? 'text-blue-500 dark:text-blue-400'
                  : 'text-yellow-600 dark:text-yellow-400'
                }`}
              >
                {f.operation}
              </span>
              <span className="font-mono text-gray-600 dark:text-gray-400 truncate flex-1">{f.path}</span>
              {onOpenFile && (
                <button
                  onClick={() => onOpenFile(f.path)}
                  className="flex-shrink-0 opacity-0 group-hover/file:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
                             text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all"
                  title="Open in editor"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MessageBubble({
  message, settings, isLastAI, chatStreaming, onEdit, onRegenerate, onBranch, onRate, onOpenFile, onOpenSettings
}: Props) {
  const isUser       = message.role === 'user'
  const isDark       = settings.theme === 'dark'
  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0

  // ── Edit mode state ────────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea and auto-size it when edit mode opens
  useEffect(() => {
    if (!isEditing || !editRef.current) return
    const el = editRef.current
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [isEditing])

  // Auto-resize as the user types
  const handleEditChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  }

  const startEdit = () => {
    setEditValue(message.content)
    setIsEditing(true)
  }

  const commitEdit = () => {
    if (!editValue.trim() && !message.images?.length) return
    onEdit?.(message.id, editValue)
    setIsEditing(false)
  }

  const cancelEdit = () => setIsEditing(false)

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  }

  // ── Whether action buttons should be visible ───────────────────────────────
  const actionsEnabled = !chatStreaming && !message.isStreaming

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group`}>

      {/* AI avatar — amber with ⚡ in agent mode, blue with "AI" in code mode */}
      {!isUser && (
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white mr-2 mt-1 flex-shrink-0 ${
          message.agentMode ? 'bg-amber-500' : 'bg-blue-600'
        }`}
          title={message.agentMode ? 'Agent mode' : 'Code mode'}
        >
          {message.agentMode ? '⚡' : 'AI'}
        </div>
      )}

      {/* Bubble + action row stacked */}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[82%]`}>

        {/* ── Bubble ── */}
        <div className={`w-full rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-md'
            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md shadow-sm dark:shadow-none border border-gray-100 dark:border-gray-700/50'
        } ${message.error && !message.content.trim() && !message.toolCalls?.length ? 'border border-red-400 dark:border-red-500' : ''
        } ${!isUser && message.rating === 'up'   ? '!border-green-300 dark:!border-green-700' : ''
        } ${!isUser && message.rating === 'down' ? '!border-red-300 dark:!border-red-800'    : ''}`}>

          {/* ── Error card — shown alone when nothing else arrived, or as footer below content ── */}
          {/* Defined as a local render helper to avoid duplication */}
          {message.error && !message.content.trim() && !message.toolCalls?.length ? (() => {
            // Nothing was produced — show error card as the sole bubble content
            const isModelError = /model|not available|not found|access denied|authentication|api key|quota|billing/i.test(message.error)
            return (
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 flex flex-col gap-2">
                <div className="flex gap-2.5 items-start">
                  <div className="flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-0.5">Error</p>
                    <p className="text-xs text-red-700 dark:text-red-300 break-words leading-relaxed">{message.error}</p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(message.error ?? '')}
                    className="flex-shrink-0 p-1 rounded text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                    title="Copy error"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                {isModelError && onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/60 border border-red-200 dark:border-red-700 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Open Settings to change model
                  </button>
                )}
              </div>
            )
          })() : isUser ? (
            // ── User message ────────────────────────────────────────────────
            isEditing ? (
              // Edit mode
              <div>
                {/* Images stay (non-editable) */}
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {message.images.map((img, i) => (
                      <img
                        key={i}
                        src={`data:${img.mimeType};base64,${img.data}`}
                        alt={`Image ${i + 1}`}
                        className="max-w-[120px] max-h-[90px] rounded-lg object-contain bg-white/10"
                      />
                    ))}
                  </div>
                )}
                <textarea
                  ref={editRef}
                  value={editValue}
                  onChange={handleEditChange}
                  onKeyDown={onEditKeyDown}
                  rows={1}
                  className="w-full bg-white/15 text-white placeholder-blue-200 resize-none outline-none rounded-xl p-2.5 text-sm leading-relaxed border border-white/25 focus:border-white/50 transition-colors min-w-[240px]"
                  placeholder="Edit your message…"
                />
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    onClick={cancelEdit}
                    className="px-3 py-1 text-xs text-blue-200 hover:text-white transition-colors rounded-lg hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={commitEdit}
                    disabled={!editValue.trim() && !message.images?.length}
                    className="px-3 py-1.5 text-xs bg-white text-blue-600 font-semibold rounded-lg hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Resend ↵
                  </button>
                </div>
                <p className="text-[10px] text-blue-200/60 mt-1.5 text-right">Ctrl+Enter to send · Esc to cancel</p>
              </div>
            ) : (
              // Normal display
              <div>
                {/* Collapsible URL fetch cards */}
                {message.urlFetches && message.urlFetches.length > 0 && (
                  <div className="mb-2 flex flex-col gap-1.5">
                    {message.urlFetches.map((f, i) => (
                      <UrlFetchCard key={i} url={f.url} content={f.content} />
                    ))}
                  </div>
                )}
                {message.images && message.images.length > 0 && (
                  <div className={`flex flex-wrap gap-2 ${message.content.trim() ? 'mb-2' : ''}`}>
                    {message.images.map((img, i) => (
                      <img
                        key={i}
                        src={`data:${img.mimeType};base64,${img.data}`}
                        alt={`Image ${i + 1}`}
                        className="max-w-[220px] max-h-[180px] rounded-xl object-contain bg-white/10 cursor-pointer"
                        onClick={() => {
                          const w = window.open()
                          if (w) w.document.write(`<img src="data:${img.mimeType};base64,${img.data}" style="max-width:100%;max-height:100vh;display:block;margin:auto;" />`)
                        }}
                        title="Click to view full size"
                      />
                    ))}
                  </div>
                )}
                {message.content.trim() && (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children }) {
                        const isInline = !className
                        const language = className?.replace('language-', '') ?? ''
                        const codeText = String(children).replace(/\n$/, '')
                        if (isInline) {
                          return (
                            <code className="bg-white/20 rounded px-1.5 py-0.5 text-[0.8em] font-mono text-blue-100">
                              {children}
                            </code>
                          )
                        }
                        // Full code block — no Run button (user messages don't execute)
                        return (
                          <div className="my-2 rounded-xl overflow-hidden border border-white/20 text-sm">
                            <div className="flex items-center justify-between px-3 py-1.5 bg-black/20">
                              <span className="text-xs font-mono text-blue-200">{language || 'text'}</span>
                              <CopyButton text={codeText} light />
                            </div>
                            <SyntaxHighlighter
                              language={language || 'text'}
                              style={oneDark}
                              customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8125rem', lineHeight: '1.6', padding: '0.75rem', background: 'rgba(0,0,0,0.25)' }}
                              showLineNumbers={codeText.split('\n').length > 5}
                              lineNumberStyle={{ color: 'rgba(255,255,255,0.25)', minWidth: '2.5em' }}
                              wrapLongLines={false}
                            >
                              {codeText}
                            </SyntaxHighlighter>
                          </div>
                        )
                      },
                      p:          ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
                      ul:         ({ children }) => <ul className="list-disc list-outside ml-4 mb-1.5 space-y-0.5">{children}</ul>,
                      ol:         ({ children }) => <ol className="list-decimal list-outside ml-4 mb-1.5 space-y-0.5">{children}</ol>,
                      li:         ({ children }) => <li className="leading-relaxed">{children}</li>,
                      strong:     ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                      em:         ({ children }) => <em className="italic text-blue-100">{children}</em>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-white/40 pl-3 my-1.5 text-blue-100 italic">
                          {children}
                        </blockquote>
                      ),
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(e) => { e.preventDefault(); if (href) window.open(href) }}
                          className="text-blue-200 hover:text-white underline cursor-pointer"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
              </div>
            )

          ) : (
            // ── AI message ──────────────────────────────────────────────────
            <div>
              {hasToolCalls && (
                <div className="mb-3 space-y-1">
                  {message.toolCalls!.map(tc => <ToolCallCard key={tc.id} call={tc} />)}
                </div>
              )}
              {/* Rate-limit retry countdown banner */}
              {message.rateLimitRetry && (
                <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                  <svg className="w-3.5 h-3.5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span>
                    Rate limited — retrying in <strong>{message.rateLimitRetry.secondsLeft}s</strong>
                    <span className="text-amber-600 dark:text-amber-400 ml-1">
                      (attempt {message.rateLimitRetry.attempt}/{message.rateLimitRetry.maxAttempts})
                    </span>
                  </span>
                </div>
              )}
              {(message.content || message.isStreaming) && (
                <div className={`prose-message ${message.isStreaming && !message.content && !message.rateLimitRetry ? 'streaming-cursor' : ''}`}>
                  {message.content ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children }) {
                          const isInline  = !className
                          const language  = className?.replace('language-', '') ?? ''
                          const codeText  = String(children).replace(/\n$/, '')
                          if (isInline) {
                            return (
                              <code className="bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5 text-[0.8em] font-mono text-pink-600 dark:text-pink-300">
                                {children}
                              </code>
                            )
                          }
                          return <CodeBlock language={language} code={codeText} isDark={isDark} />
                        },
                        h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-gray-900 dark:text-gray-100">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-2 text-gray-900 dark:text-gray-100">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1 text-gray-900 dark:text-gray-100">{children}</h3>,
                        p:  ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-outside ml-4 mb-2 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-blue-400 dark:border-blue-500 pl-3 my-2 text-gray-600 dark:text-gray-400 italic">
                            {children}
                          </blockquote>
                        ),
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-3">
                            <table className="min-w-full border border-gray-200 dark:border-gray-700 rounded-lg text-xs">{children}</table>
                          </div>
                        ),
                        thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-900">{children}</thead>,
                        th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">{children}</th>,
                        td: ({ children }) => <td className="px-3 py-2 text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800">{children}</td>,
                        strong: ({ children }) => <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>,
                        em:     ({ children }) => <em className="italic text-gray-700 dark:text-gray-300">{children}</em>,
                        hr:     () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            onClick={(e) => { e.preventDefault(); if (href) window.open(href) }}
                            className="text-blue-500 dark:text-blue-400 hover:underline cursor-pointer"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <span className="streaming-cursor" />
                  )}
                </div>
              )}
              {message.isStreaming && hasToolCalls && !message.content && (
                <span className="streaming-cursor" />
              )}
            </div>
          )}

          {/* ── Error footer — shown below content when work was done before the error ── */}
          {message.error && (message.content.trim() || message.toolCalls?.length) && (() => {
            const isModelError = /model|not available|not found|access denied|authentication|api key|quota|billing/i.test(message.error)
            return (
              <div className="mt-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 flex flex-col gap-2">
                <div className="flex gap-2.5 items-start">
                  <div className="flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-0.5">Interrupted by error</p>
                    <p className="text-xs text-red-700 dark:text-red-300 break-words leading-relaxed">{message.error}</p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(message.error ?? '')}
                    className="flex-shrink-0 p-1 rounded text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                    title="Copy error"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                {isModelError && onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/60 border border-red-200 dark:border-red-700 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Open Settings to change model
                  </button>
                )}
              </div>
            )
          })()}
        </div>

        {/* ── Session change summary + Undo ── */}
        {(message.changedFiles?.length ?? 0) > 0 && !message.isStreaming && (
          <ChangedFilesBar files={message.changedFiles!} onOpenFile={onOpenFile} />
        )}
        {message.snapshotId && !message.isStreaming && settings.workspacePath && (
          <UndoSessionButton
            snapshotId={message.snapshotId}
            workspacePath={settings.workspacePath}
            fileCount={message.changedFiles?.length ?? 0}
          />
        )}

        {/* ── Stopped badge ── */}
        {message.stopped && !isEditing && (
          <div className="flex items-center gap-1 mt-1 px-1">
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
            </svg>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">stopped</span>
          </div>
        )}

        {/* ── Action row (appears on hover, below the bubble) ── */}
        {!isEditing && actionsEnabled && (
          <div className="flex items-center gap-2 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* User message: Edit + Copy + Branch */}
            {isUser && onEdit && (
              <>
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-0.5 px-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="Edit message (replays conversation from this point)"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
                {message.content && (
                  <button
                    onClick={() => navigator.clipboard.writeText(message.content)}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-0.5 px-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Copy message"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                )}
                {onBranch && (
                  <button
                    onClick={() => onBranch(message.id)}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 transition-colors py-0.5 px-1.5 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20"
                    title="Branch conversation from here — creates a copy up to this message"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0h8m0 0a3 3 0 100 6 3 3 0 000-6m0-12a3 3 0 100-6 3 3 0 000 6m0 6V9" />
                    </svg>
                    Branch
                  </button>
                )}
              </>
            )}

            {/* AI message: Copy + Regenerate (last only) + Branch + Rate */}
            {!isUser && (
              <>
                {message.content && (
                  <button
                    onClick={() => navigator.clipboard.writeText(message.content)}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-0.5 px-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Copy response"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                )}
                {isLastAI && onRegenerate && (
                  <button
                    onClick={() => onRegenerate(message.id)}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-0.5 px-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Regenerate response"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    Regenerate
                  </button>
                )}
                {onBranch && (
                  <button
                    onClick={() => onBranch(message.id)}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 transition-colors py-0.5 px-1.5 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20"
                    title="Branch conversation from here — creates a copy up to this message"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0h8m0 0a3 3 0 100 6 3 3 0 000-6m0-12a3 3 0 100-6 3 3 0 000 6m0 6V9" />
                    </svg>
                    Branch
                  </button>
                )}
                {/* Rating buttons */}
                {onRate && message.content && !message.isStreaming && (
                  <div className="flex items-center gap-0.5 ml-1 border-l border-gray-200 dark:border-gray-700 pl-2">
                    <button
                      onClick={() => onRate(message.id, 'up')}
                      title="Good response"
                      className={`flex items-center gap-0.5 text-[11px] py-0.5 px-1.5 rounded transition-colors ${
                        message.rating === 'up'
                          ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30'
                          : 'text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                      }`}
                    >
                      <svg className="w-3 h-3" fill={message.rating === 'up' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.907m0 0a2.25 2.25 0 01-2.187-2.839l.839-3.356a2.25 2.25 0 012.187-1.661h.66a2.25 2.25 0 012.187 2.839L8.547 10.5h-2.64z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onRate(message.id, 'down')}
                      title="Bad response"
                      className={`flex items-center gap-0.5 text-[11px] py-0.5 px-1.5 rounded transition-colors ${
                        message.rating === 'down'
                          ? 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30'
                          : 'text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                      }`}
                    >
                      <svg className="w-3 h-3" fill={message.rating === 'down' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15h2.25m8.024-9.75c.011.05.028.1.052.148.591 1.2.924 2.55.924 3.977a8.96 8.96 0 01-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398C20.613 14.547 19.833 15 19 15h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 00.303-.54m.023-8.25H16.48a4.5 4.5 0 01-1.423-.23l-3.114-1.04a4.5 4.5 0 00-1.423-.23H6.504c-.618 0-1.217.247-1.605.729A11.95 11.95 0 002.25 12c0 .434.023.863.068 1.285C2.427 14.306 3.346 15 4.372 15h3.126c.618 0 .991.724.725 1.282A7.471 7.471 0 007.5 19.5a2.25 2.25 0 002.25 2.25.75.75 0 00.75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 002.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384" />
                      </svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-200 ml-2 mt-1 flex-shrink-0">
          U
        </div>
      )}
    </div>
  )
}
