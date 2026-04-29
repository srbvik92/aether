import { useState, useMemo } from 'react'
import { Conversation, ChatMessage, ToolCallDisplay } from '../../../shared/types'
import { toolIcon, toolLabel } from './MessageBubble'

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'user' | 'ai' | 'tools' | 'errors'

interface ReplayEvent {
  kind:      'user-msg' | 'tool-call' | 'ai-text'
  id:        string        // unique within this list
  msgId:     string        // parent ChatMessage id
  timestamp: number
  // user-msg
  content?:  string
  // tool-call
  toolCall?: ToolCallDisplay
  isError?:  boolean
  // ai-text
  text?:     string
  stopped?:  boolean
}

// ─── Flatten messages → ordered events ───────────────────────────────────────

function flattenMessages(messages: ChatMessage[]): ReplayEvent[] {
  const events: ReplayEvent[] = []
  for (const msg of messages) {
    if (msg.role === 'system') continue
    if (msg.role === 'user') {
      events.push({
        kind:      'user-msg',
        id:        msg.id,
        msgId:     msg.id,
        timestamp: msg.timestamp,
        content:   msg.content,
      })
    } else if (msg.role === 'assistant') {
      for (const tc of (msg.toolCalls ?? [])) {
        events.push({
          kind:      'tool-call',
          id:        `${msg.id}-tc-${tc.id}`,
          msgId:     msg.id,
          timestamp: msg.timestamp,
          toolCall:  tc,
          isError:   tc.isError || tc.status === 'error',
        })
      }
      if (msg.content || msg.error || msg.stopped) {
        events.push({
          kind:      'ai-text',
          id:        `${msg.id}-text`,
          msgId:     msg.id,
          timestamp: msg.timestamp,
          text:      msg.content || msg.error || '',
          isError:   !!msg.error,
          stopped:   !!msg.stopped,
        })
      }
    }
  }
  return events
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function computeStats(events: ReplayEvent[]) {
  const turns       = events.filter(e => e.kind === 'user-msg').length
  const toolCalls   = events.filter(e => e.kind === 'tool-call').length
  const errors      = events.filter(e => e.isError).length
  const filesWritten = events.filter(e =>
    e.kind === 'tool-call' &&
    ['write_file', 'str_replace', 'delete_file', 'rename_file', 'move_file'].includes(e.toolCall?.name ?? '')
  ).length
  return { turns, toolCalls, errors, filesWritten }
}

// ─── Helper: format timestamp ─────────────────────────────────────────────────

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Collapsible tool output ──────────────────────────────────────────────────

function ToolCallRow({ event }: { event: ReplayEvent }) {
  const [expanded, setExpanded] = useState(event.isError)
  const tc = event.toolCall!

  const subtitle =
    tc.input.path         ? String(tc.input.path) :
    tc.input.old_path     ? `${tc.input.old_path} → ${tc.input.new_path ?? ''}` :
    tc.input.command      ? String(tc.input.command) :
    tc.input.pattern      ? `"${tc.input.pattern}"` :
    tc.input.query        ? `"${tc.input.query}"` :
    tc.input.message      ? String(tc.input.message) :
    null

  const isErr  = event.isError
  const isDone = tc.status === 'done'

  return (
    <div className={`rounded-lg border text-xs overflow-hidden ${
      isErr
        ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'
    }`}>
      {/* Header row */}
      <div
        className={`flex items-center gap-2 px-3 py-2 ${tc.output ? 'cursor-pointer' : ''}`}
        onClick={() => tc.output && setExpanded(e => !e)}
      >
        <span className="flex-shrink-0">{toolIcon(tc.name)}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">{toolLabel(tc.name)}</span>
        {subtitle && (
          <span className="font-mono text-gray-400 dark:text-gray-500 truncate max-w-[240px]">{subtitle}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {isErr ? (
            <span className="text-red-500 dark:text-red-400 font-medium">✕ Error</span>
          ) : isDone ? (
            <span className="text-green-600 dark:text-green-400">✓ Done</span>
          ) : (
            <span className="text-gray-400">{tc.status}</span>
          )}
          {tc.output && (
            <svg className={`w-3 h-3 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </div>

      {/* Expandable: input + output */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {Object.keys(tc.input).length > 0 && (
            <div className="px-3 py-2 bg-gray-100 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">Input</p>
              <pre className="text-[11px] font-mono text-gray-600 dark:text-gray-300 whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                {JSON.stringify(tc.input, null, 2)}
              </pre>
            </div>
          )}
          {tc.output && (
            <div className="px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">Output</p>
              <pre className={`text-[11px] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed ${
                isErr ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'
              }`}>
                {tc.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── AI text row ──────────────────────────────────────────────────────────────

function AiTextRow({ event }: { event: ReplayEvent }) {
  const [expanded, setExpanded] = useState(false)
  const text   = event.text ?? ''
  const lines  = text.split('\n')
  const isLong = lines.length > 4 || text.length > 300
  const preview = isLong && !expanded
    ? text.slice(0, 300).trimEnd() + '…'
    : text

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${
      event.isError
        ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
        : 'border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800'
    }`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0">AI</div>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${
          event.isError ? 'text-red-500' : event.stopped ? 'text-orange-500' : 'text-blue-500'
        }`}>
          {event.isError ? 'Error' : event.stopped ? 'Stopped' : 'Response'}
        </span>
      </div>
      <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words font-mono text-[11px]">
        {preview}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1.5 text-[10px] text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          {expanded ? '▲ Show less' : `▼ Show all (${lines.length} lines)`}
        </button>
      )}
    </div>
  )
}

// ─── Turn group (user message + its tool calls + AI response) ─────────────────

function TurnGroup({
  turnIdx, userEvent, childEvents, filter, onJumpTo
}: {
  turnIdx:     number
  userEvent:   ReplayEvent
  childEvents: ReplayEvent[]
  filter:      FilterType
  onJumpTo:    (msgId: string) => void
}) {
  // Apply filter to child events
  const filteredChildren = childEvents.filter(e => {
    if (filter === 'all')    return true
    if (filter === 'tools')  return e.kind === 'tool-call'
    if (filter === 'ai')     return e.kind === 'ai-text'
    if (filter === 'errors') return e.isError
    return true
  })

  // If filter hides this turn entirely
  if (filter === 'tools' && filteredChildren.length === 0) return null
  if (filter === 'ai'    && filteredChildren.length === 0) return null
  if (filter === 'errors' && !userEvent.isError && filteredChildren.every(e => !e.isError)) return null

  const hasErrors = filteredChildren.some(e => e.isError)

  return (
    <div className="relative">
      {/* Timeline connector line */}
      <div className="absolute left-[11px] top-7 bottom-0 w-px bg-gray-200 dark:bg-gray-700" aria-hidden />

      {/* Turn header — user message */}
      {filter !== 'tools' && filter !== 'ai' && filter !== 'errors' && (
        <div className="flex items-start gap-3 mb-2">
          {/* Circle */}
          <div className="flex-shrink-0 w-[23px] h-[23px] rounded-full border-2 border-blue-400 bg-white dark:bg-gray-950 flex items-center justify-center z-10 mt-0.5">
            <span className="text-[8px] font-bold text-blue-500">{turnIdx + 1}</span>
          </div>

          <div className="flex-1 min-w-0 pb-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">User</span>
              <span className="text-[10px] text-gray-400">{fmtTime(userEvent.timestamp)}</span>
              {hasErrors && <span className="text-[10px] text-red-500">⚠ errors</span>}
              <button
                onClick={() => onJumpTo(userEvent.msgId)}
                className="ml-auto text-[10px] text-gray-400 hover:text-blue-500 transition-colors"
                title="Jump to this message in chat"
              >
                ↗ view
              </button>
            </div>
            {userEvent.content && (
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug line-clamp-3">
                {userEvent.content}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Children: tool calls + AI text */}
      {filteredChildren.length > 0 && (
        <div className="ml-8 space-y-1.5 pb-4">
          {filteredChildren.map(e => (
            <div key={e.id}>
              {e.kind === 'tool-call' && <ToolCallRow event={e} />}
              {e.kind === 'ai-text'   && <AiTextRow   event={e} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  conversation: Conversation
  onClose:      () => void
  onJumpTo:     (msgId: string) => void   // navigate to message in chat
}

export default function SessionReplayPanel({ conversation, onClose, onJumpTo }: Props) {
  const [filter, setFilter] = useState<FilterType>('all')

  const allEvents = useMemo(
    () => flattenMessages(conversation.messages),
    [conversation.messages]
  )

  const stats = useMemo(() => computeStats(allEvents), [allEvents])

  // Group events into turns: each turn starts with a user-msg
  const turns = useMemo(() => {
    const result: { userEvent: ReplayEvent; children: ReplayEvent[] }[] = []
    let current: { userEvent: ReplayEvent; children: ReplayEvent[] } | null = null

    for (const e of allEvents) {
      if (e.kind === 'user-msg') {
        if (current) result.push(current)
        current = { userEvent: e, children: [] }
      } else if (current) {
        current.children.push(e)
      }
      // Events before first user message are ignored (shouldn't happen in practice)
    }
    if (current) result.push(current)
    return result
  }, [allEvents])

  // Filter chips config
  const chips: { id: FilterType; label: string; count?: number }[] = [
    { id: 'all',    label: 'All',     count: allEvents.length },
    { id: 'user',   label: '👤 User', count: stats.turns },
    { id: 'ai',     label: '🤖 AI',   count: allEvents.filter(e => e.kind === 'ai-text').length },
    { id: 'tools',  label: '🔧 Tools',count: stats.toolCalls },
    { id: 'errors', label: '✕ Errors',count: stats.errors },
  ]

  // Export audit log as text
  const handleExport = () => {
    const lines: string[] = [`# Audit Log — ${conversation.title}`, `Generated: ${new Date().toISOString()}`, '']
    for (const { userEvent, children } of turns) {
      lines.push(`## [User] ${fmtTime(userEvent.timestamp)}`)
      lines.push(userEvent.content ?? '')
      lines.push('')
      for (const e of children) {
        if (e.kind === 'tool-call' && e.toolCall) {
          const tc = e.toolCall
          lines.push(`### ${toolLabel(tc.name)} — ${e.isError ? 'ERROR' : 'Done'}`)
          lines.push(`Input: ${JSON.stringify(tc.input)}`)
          if (tc.output) lines.push(`Output:\n${tc.output}`)
          lines.push('')
        } else if (e.kind === 'ai-text') {
          lines.push(`### [AI Response]`)
          lines.push(e.text ?? '')
          lines.push('')
        }
      }
      lines.push('---')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `audit-${conversation.id.slice(0, 8)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Handle overlay click
  const onOverlay = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[5vh] px-4 pb-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onOverlay}
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              Session Audit Log
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{conversation.title}</p>
          </div>

          {/* Export button */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export
          </button>

          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Stats bar ── */}
        <div className="flex items-center gap-4 px-5 py-2.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 flex-wrap">
          {[
            { label: 'turns',         value: stats.turns },
            { label: 'tool calls',    value: stats.toolCalls },
            { label: 'files changed', value: stats.filesWritten },
            { label: 'errors',        value: stats.errors, red: stats.errors > 0 },
          ].map(s => (
            <span key={s.label} className="flex items-center gap-1 text-xs">
              <span className={`font-semibold ${s.red ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'}`}>
                {s.value}
              </span>
              <span className="text-gray-400 dark:text-gray-600">{s.label}</span>
            </span>
          ))}
        </div>

        {/* ── Filter chips ── */}
        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 overflow-x-auto">
          {chips.map(chip => (
            <button
              key={chip.id}
              onClick={() => setFilter(chip.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filter === chip.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              } ${chip.id === 'errors' && stats.errors > 0 && filter !== 'errors' ? 'text-red-500' : ''}`}
            >
              {chip.label}
              {chip.count !== undefined && (
                <span className={`text-[10px] ${filter === chip.id ? 'text-blue-200' : 'text-gray-400 dark:text-gray-600'}`}>
                  {chip.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Timeline ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-0">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-600">
              <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <p className="text-sm">No messages yet</p>
            </div>
          ) : (
            turns.map((turn, idx) => (
              <TurnGroup
                key={turn.userEvent.id}
                turnIdx={idx}
                userEvent={turn.userEvent}
                childEvents={turn.children}
                filter={filter}
                onJumpTo={(msgId) => { onJumpTo(msgId); onClose() }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
