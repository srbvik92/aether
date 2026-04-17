import React, { useMemo } from 'react'
import { ChatMessage } from '../../../shared/types'

interface Task {
  done: boolean
  label: string
}

interface Props {
  /** All messages from this conversation */
  messages: ChatMessage[]
  /** Current auto-continue turn count */
  autoContinueCount: number
  maxContinues?: number
  /** Whether auto-continue is paused */
  agentPaused: boolean
  /** Whether the stream is currently active */
  isStreaming: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

/** Parse all checkbox items from markdown content */
function parseTasks(messages: ChatMessage[]): Task[] {
  const tasks: Task[] = []
  const seen = new Set<string>()
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const lines = msg.content.split('\n')
    for (const line of lines) {
      const m = line.match(/^\s*-\s*\[(x| )\]\s+(.+)$/i)
      if (m) {
        const label = m[2].trim()
        if (!seen.has(label)) {
          seen.add(label)
          tasks.push({ done: m[1].toLowerCase() === 'x', label })
        } else {
          // Update existing task if now marked done
          const idx = tasks.findIndex(t => t.label === label)
          if (idx >= 0 && m[1].toLowerCase() === 'x') tasks[idx].done = true
        }
      }
    }
  }
  return tasks
}

function statusLabel(streaming: boolean, agentPaused: boolean, tasks: Task[], autoContinueCount: number) {
  if (streaming && !agentPaused) return 'Working…'
  if (agentPaused) return 'Paused'
  const total = tasks.length
  const done = tasks.filter(t => t.done).length
  if (total > 0 && done === total) return 'Complete'
  if (autoContinueCount > 0) return 'Idle'
  return 'Ready'
}

export default function AgentProgressPanel({
  messages,
  autoContinueCount,
  maxContinues = 20,
  agentPaused,
  isStreaming,
  onPause,
  onResume,
  onStop
}: Props) {
  const tasks = useMemo(() => parseTasks(messages), [messages])
  const done = tasks.filter(t => t.done).length
  const total = tasks.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const status = statusLabel(isStreaming, agentPaused, tasks, autoContinueCount)
  const isComplete = total > 0 && done === total

  return (
    <div className="w-64 flex-shrink-0 border-l border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900/50 text-xs">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .3 2.7-1.1 2.7H3.9c-1.4 0-2.1-1.7-1.1-2.7L4.6 15.3" />
        </svg>
        <span className="font-semibold text-gray-700 dark:text-gray-200">Agent Progress</span>
        <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
          status === 'Working…' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' :
          status === 'Paused'   ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-300' :
          status === 'Complete' ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300' :
          'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
        }`}>
          {status}
        </span>
      </div>

      {/* Progress bar + turn counter */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 space-y-1.5">
        {total > 0 && (
          <>
            <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
              <span>{done}/{total} tasks</span>
              <span className="font-medium">{pct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isComplete ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
        {total === 0 && (
          <p className="text-gray-400 dark:text-gray-600 italic">Waiting for task plan…</p>
        )}
        <div className="flex items-center justify-between text-gray-400 dark:text-gray-600">
          <span>Turn {autoContinueCount}/{maxContinues}</span>
          {isStreaming && !agentPaused && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Running
            </span>
          )}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 min-h-0">
        {tasks.length === 0 && (
          <p className="text-gray-400 dark:text-gray-600 italic text-[11px] leading-relaxed">
            Task steps will appear here once the agent starts planning.
          </p>
        )}
        {tasks.map((task, i) => (
          <div key={i} className={`flex items-start gap-1.5 ${task.done ? 'opacity-60' : ''}`}>
            <span className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center ${
              task.done
                ? 'bg-green-500 border-green-500'
                : 'border-gray-300 dark:border-gray-600'
            }`}>
              {task.done && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            <span className={`leading-tight ${task.done ? 'line-through text-gray-400 dark:text-gray-600' : 'text-gray-700 dark:text-gray-300'}`}>
              {task.label}
            </span>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800 flex items-center gap-1.5">
        {!agentPaused && isStreaming ? (
          <button
            onClick={onPause}
            className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors font-medium"
            title="Pause auto-continue"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
            Pause
          </button>
        ) : agentPaused ? (
          <button
            onClick={onResume}
            className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors font-medium"
            title="Resume auto-continue"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
            Resume
          </button>
        ) : null}
        {(isStreaming || agentPaused) && (
          <button
            onClick={onStop}
            className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors font-medium"
            title="Stop agent"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z"/>
            </svg>
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
