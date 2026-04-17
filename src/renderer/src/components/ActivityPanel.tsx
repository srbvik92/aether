import { useMemo } from 'react'
import { AppSettings, ChatMessage, ToolCallDisplay } from '../../../shared/types'

interface Props {
  settings:    AppSettings
  messages:    ChatMessage[]
  isStreaming: boolean
  isOpen:      boolean
  onToggle:    () => void
}

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '◆',
  openai:    '○',
  gemini:    '✦',
  nvidia:    '▣',
  custom:    '◈',
}

const TOOL_ICONS: Record<string, string> = {
  read_file:       '📄',
  write_file:      '✏️',
  edit_file:       '✏️',
  list_directory:  '📁',
  execute_command: '⚡',
  bash:            '⚡',
  web_search:      '🔍',
  fetch_url:       '🌐',
  grep_search:     '🔎',
  file_search:     '🔎',
  create_file:     '📝',
  delete_file:     '🗑️',
  move_file:       '↔️',
  copy_file:       '📋',
  git_status:      '⎇',
  git_commit:      '⎇',
  git_diff:        '⎇',
  run_tests:       '🧪',
  spawn_agent:     '🤖',
}

function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? '🔧'
}

function toolLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatArg(input: Record<string, unknown>): string {
  const keys = ['path', 'file_path', 'command', 'query', 'url', 'pattern']
  for (const k of keys) {
    if (typeof input[k] === 'string') {
      const v = input[k] as string
      // Shorten long paths — show last 2 segments
      if (v.length > 40) {
        const parts = v.replace(/\\/g, '/').split('/')
        return '…/' + parts.slice(-2).join('/')
      }
      return v
    }
  }
  const first = Object.values(input)[0]
  if (typeof first === 'string') return first.slice(0, 40)
  return ''
}

export default function ActivityPanel({ settings, messages, isStreaming, isOpen, onToggle }: Props) {
  // Collect all tool calls across all messages, most recent first
  const allToolCalls = useMemo(() => {
    const calls: Array<{ tool: ToolCallDisplay; msgIdx: number }> = []
    messages.forEach((m, i) => {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        m.toolCalls.forEach(tc => calls.push({ tool: tc, msgIdx: i }))
      }
    })
    return calls.reverse()
  }, [messages])

  // Running tools (from the streaming message)
  const runningTools = allToolCalls.filter(c => c.tool.status === 'running').slice(0, 5)

  // Recent completed tools (last 20)
  const recentTools = allToolCalls.filter(c => c.tool.status !== 'running').slice(0, 20)

  // Changed files across all messages
  const changedFiles = useMemo(() => {
    const seen = new Set<string>()
    const files: Array<{ path: string; type: string }> = []
    messages.forEach(m => {
      m.changedFiles?.forEach(f => {
        if (!seen.has(f.path)) { seen.add(f.path); files.push(f) }
      })
    })
    return files.slice(-12) // last 12
  }, [messages])

  // Stats
  const totalTools  = allToolCalls.length
  const errorTools  = allToolCalls.filter(c => c.tool.status === 'error').length
  const totalTurns  = messages.filter(m => m.role === 'assistant').length

  const modelShort = settings.model.split('/').pop() ?? settings.model
  const providerIcon = PROVIDER_ICONS[settings.provider] ?? '◈'

  // ── Collapsed rail ───────────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <div className="flex-shrink-0 w-7 border-l border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex flex-col items-center py-2 gap-3">
        {/* Toggle */}
        <button
          onClick={onToggle}
          title="Open activity panel"
          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Streaming pulse dot */}
        {isStreaming && (
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" title="Processing…" />
        )}

        {/* Tool count pip */}
        {totalTools > 0 && !isStreaming && (
          <span
            className="text-[9px] font-bold text-gray-400 dark:text-gray-600 tabular-nums"
            title={`${totalTools} tool calls`}
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {totalTools}
          </span>
        )}

        {/* Error warning */}
        {errorTools > 0 && (
          <span className="w-2 h-2 rounded-full bg-red-500" title={`${errorTools} tool error(s)`} />
        )}
      </div>
    )
  }

  // ── Expanded panel ───────────────────────────────────────────────────────────
  return (
    <div className="w-64 flex-shrink-0 border-l border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900/50 text-xs">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <span className="font-semibold text-gray-600 dark:text-gray-400 tracking-wide uppercase text-[10px]">Activity</span>
        <button
          onClick={onToggle}
          title="Collapse panel"
          className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── Model info ── */}
        <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1.5">Model</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">{providerIcon}</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800 dark:text-gray-200 truncate" title={settings.model}>{modelShort}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-600 capitalize">{settings.provider}</p>
            </div>
            {/* Status badge */}
            <span className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${
              isStreaming
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500'
            }`}>
              {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
              {isStreaming ? 'Working' : 'Idle'}
            </span>
          </div>

          {/* Stats row */}
          {totalTurns > 0 && (
            <div className="flex items-center gap-3 mt-2">
              <span className="text-gray-400 dark:text-gray-600">{totalTurns} turn{totalTurns !== 1 ? 's' : ''}</span>
              <span className="text-gray-400 dark:text-gray-600">{totalTools} tool call{totalTools !== 1 ? 's' : ''}</span>
              {errorTools > 0 && (
                <span className="text-red-500 dark:text-red-400 font-medium">{errorTools} error{errorTools !== 1 ? 's' : ''}</span>
              )}
            </div>
          )}
        </div>

        {/* ── Active tools (streaming) ── */}
        {runningTools.length > 0 && (
          <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1.5">Running</p>
            <div className="space-y-1.5">
              {runningTools.map(({ tool }, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="flex-shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-blue-600 dark:text-blue-400 truncate">{toolLabel(tool.name)}</p>
                    {tool.liveOutput && (
                      <p className="text-gray-400 dark:text-gray-600 truncate font-mono text-[9px] mt-0.5">{tool.liveOutput.slice(-60)}</p>
                    )}
                    {!tool.liveOutput && (
                      <p className="text-gray-400 dark:text-gray-600 truncate">{formatArg(tool.input)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Changed files ── */}
        {changedFiles.length > 0 && (
          <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1.5">
              Files changed ({changedFiles.length})
            </p>
            <div className="space-y-1">
              {changedFiles.map((f, i) => {
                const parts = f.path.replace(/\\/g, '/').split('/')
                const name  = parts[parts.length - 1]
                const dir   = parts.length > 1 ? parts[parts.length - 2] + '/' : ''
                return (
                  <div key={i} className="flex items-center gap-1.5" title={f.path}>
                    <span className={`flex-shrink-0 text-[9px] font-bold px-1 rounded ${
                      f.type === 'created' ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400' :
                      f.type === 'deleted' ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' :
                      'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-400'
                    }`}>
                      {f.type === 'created' ? 'A' : f.type === 'deleted' ? 'D' : 'M'}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300">
                      <span className="text-gray-400 dark:text-gray-600">{dir}</span>{name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Recent tool calls ── */}
        {recentTools.length > 0 && (
          <div className="px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1.5">
              Recent tools
            </p>
            <div className="space-y-1">
              {recentTools.map(({ tool }, i) => (
                <div key={i} className="flex items-start gap-1.5 group">
                  {/* Status dot */}
                  <span className={`flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${
                    tool.status === 'error' ? 'bg-red-400' : 'bg-green-400 dark:bg-green-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px]">{toolIcon(tool.name)}</span>
                      <span className={`font-medium truncate ${
                        tool.status === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}>
                        {toolLabel(tool.name)}
                      </span>
                    </div>
                    <p className="text-gray-400 dark:text-gray-600 truncate font-mono text-[9px]">
                      {formatArg(tool.input)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {totalTools === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-gray-400 dark:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <p className="text-xs text-center">No tool activity yet.<br/>Start a conversation to see activity here.</p>
          </div>
        )}
      </div>
    </div>
  )
}
