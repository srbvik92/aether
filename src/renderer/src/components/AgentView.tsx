import React, { useMemo, useState, useRef, useEffect, KeyboardEvent } from 'react'
import { ChatMessage, ToolCallDisplay } from '../../../shared/types'
import { toolIcon, toolLabel } from './MessageBubble'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
  autoContinueCount: number
  maxContinues: number
  agentPaused: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onSendMessage: (text: string) => void
}

// ── Task parsing ──────────────────────────────────────────────────────────────

interface Task {
  label: string
  done: boolean
}

/** Parse all checkbox items from ALL assistant messages, de-duplicated by label */
function parseTasks(messages: ChatMessage[]): Task[] {
  const tasks: Task[] = []
  const seen = new Map<string, number>() // label -> index in tasks

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const lines = msg.content.split('\n')
    for (const line of lines) {
      const m = line.match(/^\s*-\s*\[(x| )\]\s+(.+)$/i)
      if (!m) continue
      const label = m[2].trim()
      const done = m[1].toLowerCase() === 'x'
      if (!seen.has(label)) {
        seen.set(label, tasks.length)
        tasks.push({ label, done })
      } else {
        const idx = seen.get(label)!
        // Update to done if the latest occurrence is checked
        if (done) tasks[idx].done = true
      }
    }
  }
  return tasks
}

// ── Tool call mini-card ───────────────────────────────────────────────────────

function MiniToolCard({ call }: { call: ToolCallDisplay }) {
  const isRunning  = call.status === 'running'
  const isAwaiting = call.status === 'awaiting-approval'
  const isError    = call.status === 'error' || call.isError
  const isShell    = call.name === 'run_command' || call.name === 'run_docker'

  const liveRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (liveRef.current) {
      liveRef.current.scrollTop = liveRef.current.scrollHeight
    }
  }, [call.liveOutput, call.output])

  const terminalText = call.liveOutput ?? call.output ?? ''
  const terminalLines = terminalText.split('\n')
  const displayLines = terminalLines.slice(-20).join('\n')

  return (
    <div className={`rounded-lg border text-xs overflow-hidden mb-1.5 ${
      isError    ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20' :
      isAwaiting ? 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20' :
      isRunning  ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20' :
                   'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="text-sm">{toolIcon(call.name)}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">{toolLabel(call.name)}</span>
        {call.input.command && (
          <span className="font-mono text-gray-400 dark:text-gray-500 truncate max-w-[200px]">
            {String(call.input.command)}
          </span>
        )}
        {!call.input.command && call.input.path && (
          <span className="font-mono text-gray-400 dark:text-gray-500 truncate max-w-[200px]">
            {String(call.input.path)}
          </span>
        )}
        {/* Status badge */}
        <div className="ml-auto flex-shrink-0">
          {isRunning && (
            <svg className="w-3.5 h-3.5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          )}
          {isAwaiting && (
            <svg className="w-3.5 h-3.5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
          )}
          {isError && (
            <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {!isRunning && !isAwaiting && !isError && (
            <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>

      {/* Terminal block for shell tools */}
      {isShell && (isRunning || terminalText) && (
        <pre
          ref={liveRef}
          className="bg-[#1e1e1e] text-gray-200 font-mono text-xs px-3 py-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all"
        >
          {displayLines || ' '}
        </pre>
      )}
    </div>
  )
}

// ── Transcript panel ──────────────────────────────────────────────────────────

function TranscriptPanel({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 max-h-64 overflow-y-auto px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Transcript</p>
      {messages.map((msg) => (
        <div key={msg.id} className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-600 mb-0.5">
            {msg.role}
          </p>
          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words font-sans leading-relaxed">
            {msg.content || '(no text content)'}
          </pre>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AgentView({
  messages,
  isStreaming,
  autoContinueCount,
  maxContinues,
  agentPaused,
  onPause,
  onResume,
  onStop,
  onSendMessage,
}: Props) {
  const [showTranscript, setShowTranscript] = useState(false)
  const [interruptText, setInterruptText] = useState('')
  const taskListRef = useRef<HTMLDivElement>(null)

  // Parse tasks
  const tasks = useMemo(() => parseTasks(messages), [messages])
  const doneCount = tasks.filter(t => t.done).length
  const totalCount = tasks.length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  // Goal = first user message content
  const goal = useMemo(() => {
    const first = messages.find(m => m.role === 'user')
    return first?.content ?? ''
  }, [messages])

  // Detect empty response: last assistant message has no content and no tool calls
  // (useChat marks these with an error string so we also catch that)
  const lastAssistantIsEmpty = useMemo(() => {
    if (isStreaming) return false
    const last = [...messages].reverse().find(m => m.role === 'assistant')
    if (!last) return false
    const hasContent   = last.content.trim().length > 0
    const hasToolCalls = (last.toolCalls?.length ?? 0) > 0
    // Either truly empty, or tagged with the empty-response error by useChat
    const isEmptyError = last.error?.includes('empty response') ?? false
    return (!hasContent && !hasToolCalls) || isEmptyError
  }, [messages, isStreaming])

  // Detect completion from AI text even if checkboxes weren't updated
  const isTextComplete = useMemo(() => {
    if (isStreaming) return false
    const donePatterns = [
      /all\s+tasks?\s+(are\s+)?(complete|done|finished)/i,
      /implementation\s+(is\s+)?(complete|done|finished)/i,
      /everything\s+(is\s+)?(complete|done|finished)/i,
      /that\s+completes?\s+(the|all)/i,
      /task\s+is\s+fully\s+(complete|done)/i,
    ]
    // Check last few assistant messages for completion signals
    const aiMsgs = messages.filter(m => m.role === 'assistant')
    return aiMsgs.slice(-3).some(m => donePatterns.some(r => r.test(m.content)))
  }, [messages, isStreaming])

  // Consider all tasks done if text signals completion (even if [x] not updated)
  const effectiveDoneCount = isTextComplete ? totalCount : doneCount
  const effectivePct       = totalCount > 0 ? Math.round((effectiveDoneCount / totalCount) * 100) : (isTextComplete ? 100 : 0)
  const isFullyComplete    = (doneCount === totalCount && totalCount > 0) || isTextComplete

  // Active task = first not-done task while streaming
  const activeTaskIndex = isStreaming ? tasks.findIndex(t => !t.done) : -1

  // Tool calls from the most recent streaming/latest assistant message
  const latestAssistantMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i]
    }
    return null
  }, [messages])

  const activeToolCalls: ToolCallDisplay[] = isStreaming && latestAssistantMsg
    ? (latestAssistantMsg.toolCalls ?? [])
    : []

  // Auto-scroll task list to keep active task visible
  useEffect(() => {
    if (activeTaskIndex >= 0 && taskListRef.current) {
      const rows = taskListRef.current.querySelectorAll('[data-task-row]')
      const el = rows[activeTaskIndex] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeTaskIndex])

  const handleInterruptSubmit = () => {
    const text = interruptText.trim()
    if (!text) return
    setInterruptText('')
    onSendMessage(text)
  }

  const handleInterruptKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleInterruptSubmit()
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-50 dark:bg-gray-950">

      {/* ── Goal card ────────────────────────────────────────────────────── */}
      {goal && (
        <div className="mx-4 mt-4 border-l-4 border-amber-400 bg-white dark:bg-gray-900 rounded-r-xl px-4 py-3 shadow-sm flex-shrink-0">
          <div className="flex items-start gap-2">
            <span className="text-base mt-0.5 flex-shrink-0">⚡</span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-0.5">
                Goal
              </p>
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug line-clamp-2">
                {goal}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {(totalCount > 0 || isTextComplete) && (
        <div className="mx-4 mt-3 flex-shrink-0">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>{isTextComplete && totalCount === 0 ? 'Complete' : `${effectiveDoneCount}/${totalCount} tasks`}</span>
            <span>Turn {autoContinueCount}/{maxContinues}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isFullyComplete ? 'bg-green-500' : 'bg-amber-400'
              }`}
              style={{ width: `${effectivePct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Task list ────────────────────────────────────────────────────── */}
      <div
        ref={taskListRef}
        className="flex-1 overflow-y-auto px-4 py-3 min-h-0 space-y-1.5"
      >
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full select-none py-12">
            {isStreaming ? (
              <div className="flex flex-col items-center text-gray-400 dark:text-gray-600">
                <svg className="w-8 h-8 animate-spin text-amber-400 mb-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                <p className="text-sm">Agent is planning tasks…</p>
              </div>
            ) : lastAssistantIsEmpty ? (
              /* Empty response — model returned nothing */
              <div className="flex flex-col items-center gap-3 max-w-xs text-center">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Agent returned an empty response</p>
                  <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
                    The model responded with no content. This can happen after long idle periods or with certain models. Try sending again.
                  </p>
                </div>
                <button
                  onClick={() => onSendMessage(goal)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Retry
                </button>
              </div>
            ) : (
              <p className="text-sm italic text-gray-400 dark:text-gray-600">
                Task steps will appear here once the agent starts planning.
              </p>
            )}
          </div>
        )}

        {tasks.map((task, i) => {
          const isActive = i === activeTaskIndex
          const isPending = !task.done && !isActive

          return (
            <div
              key={i}
              data-task-row
              className={`rounded-xl px-3 py-2.5 transition-all text-sm ${
                isActive
                  ? 'border-l-4 border-amber-400 bg-white dark:bg-gray-900 shadow-sm'
                  : task.done
                    ? 'bg-transparent'
                    : 'bg-transparent'
              }`}
            >
              {/* Task header row */}
              <div className="flex items-start gap-2.5">
                {/* Status indicator */}
                <div className="flex-shrink-0 mt-0.5">
                  {(task.done || isTextComplete) ? (
                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : isActive ? (
                    <span className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-amber-400 bg-amber-400/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    </span>
                  ) : (
                    <span className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                  )}
                </div>

                {/* Label */}
                <span className={`leading-snug flex-1 ${
                  task.done || isTextComplete
                    ? 'line-through text-gray-400 dark:text-gray-600'
                    : isActive
                      ? 'text-gray-800 dark:text-gray-100 font-medium'
                      : isPending
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-700 dark:text-gray-300'
                }`}>
                  {task.label}
                </span>
              </div>

              {/* Active task: show tool calls */}
              {isActive && activeToolCalls.length > 0 && (
                <div className="mt-2.5 ml-6.5 space-y-0">
                  {activeToolCalls.map((tc) => (
                    <MiniToolCard key={tc.id} call={tc} />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* ── Completion banner ──────────────────────────────────────── */}
        {isFullyComplete && !isStreaming && (
          <div className="mt-3 mx-1 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">All tasks complete</p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                Switch to Code tab to review what was built, or send a follow-up below.
              </p>
            </div>
          </div>
        )}

        {/* ── Text-complete hint (checkboxes not updated by model) ──── */}
        {isTextComplete && !isFullyComplete && !isStreaming && totalCount > 0 && (
          <div className="mt-3 mx-1 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 flex items-start gap-3">
            <span className="text-blue-500 mt-0.5">ℹ️</span>
            <div>
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Agent reported completion</p>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                The agent said all tasks are done but didn't update the checkboxes. Switch to Code tab to verify.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Transcript panel (slide-up, above controls) ───────────────── */}
      {showTranscript && <TranscriptPanel messages={messages} />}

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2 flex items-center gap-2">
        {/* Left: Pause/Resume + Stop */}
        <div className="flex items-center gap-1.5">
          {(isStreaming || agentPaused) && (
            <>
              {!agentPaused ? (
                <button
                  onClick={onPause}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors text-xs font-medium"
                  title="Pause agent"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                  Pause
                </button>
              ) : (
                <button
                  onClick={onResume}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors text-xs font-medium"
                  title="Resume agent"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Resume
                </button>
              )}
              <button
                onClick={onStop}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors text-xs font-medium"
                title="Stop agent"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z"/>
                </svg>
                Stop
              </button>
            </>
          )}
        </div>

        {/* Right: turn counter + transcript toggle */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-gray-600">
            Turn {autoContinueCount}/{maxContinues}
          </span>
          <button
            onClick={() => setShowTranscript(v => !v)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
              showTranscript
                ? 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
            title="Toggle raw transcript"
          >
            💬 {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </button>
        </div>
      </div>

      {/* ── Interrupt input ───────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 pb-3 pt-2">
        <div className={`flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors ${
          isStreaming
            ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 opacity-60 cursor-not-allowed'
            : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 focus-within:border-amber-400 dark:focus-within:border-amber-500'
        }`}>
          <textarea
            value={interruptText}
            onChange={e => setInterruptText(e.target.value)}
            onKeyDown={handleInterruptKey}
            disabled={isStreaming}
            placeholder="Redirect agent or ask a question…"
            rows={2}
            className="flex-1 resize-none bg-transparent text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 outline-none disabled:cursor-not-allowed"
          />
          {!isStreaming && interruptText.trim() && (
            <button
              onClick={handleInterruptSubmit}
              className="flex-shrink-0 p-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-white transition-colors"
              title="Send"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.269 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
