/**
 * Task Queue panel — queue multiple prompts to run sequentially.
 * The parent component calls onRunNext() whenever streaming ends
 * and there are pending items in the queue.
 */

import { useState, useRef, useEffect, useCallback } from 'react'

export interface QueuedTask {
  id:     string
  prompt: string
  status: 'pending' | 'running' | 'done' | 'error'
}

interface Props {
  isStreaming: boolean
  onSend:     (prompt: string) => void
  onClose:    () => void
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export default function TaskQueuePanel({ isStreaming, onSend, onClose }: Props) {
  const [tasks,     setTasks]     = useState<QueuedTask[]>([])
  const [input,     setInput]     = useState('')
  const [autoRun,   setAutoRun]   = useState(true)
  const inputRef                  = useRef<HTMLTextAreaElement>(null)
  const prevStreaming              = useRef(isStreaming)

  // Auto-advance: when streaming stops and autoRun is on, send the next pending task
  useEffect(() => {
    if (prevStreaming.current && !isStreaming && autoRun) {
      // Mark last 'running' task as done
      setTasks(prev => {
        const updated = prev.map(t => t.status === 'running' ? { ...t, status: 'done' as const } : t)
        // Find next pending
        const next = updated.find(t => t.status === 'pending')
        if (next) {
          setTimeout(() => {
            setTasks(q => q.map(t => t.id === next.id ? { ...t, status: 'running' } : t))
            onSend(next.prompt)
          }, 300)
        }
        return updated
      })
    }
    prevStreaming.current = isStreaming
  }, [isStreaming, autoRun, onSend])

  const addTask = useCallback(() => {
    const text = input.trim()
    if (!text) return
    setTasks(prev => [...prev, { id: genId(), prompt: text, status: 'pending' }])
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [input])

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [])

  const runNow = useCallback(() => {
    if (isStreaming) return
    const next = tasks.find(t => t.status === 'pending')
    if (!next) return
    setTasks(prev => prev.map(t => t.id === next.id ? { ...t, status: 'running' } : t))
    onSend(next.prompt)
  }, [tasks, isStreaming, onSend])

  const clearDone = useCallback(() => {
    setTasks(prev => prev.filter(t => t.status !== 'done'))
  }, [])

  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const doneCount    = tasks.filter(t => t.status === 'done').length

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none"
    >
      <div className="w-[440px] max-w-[96vw] max-h-[80vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden pointer-events-auto">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="text-lg leading-none">📋</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Task Queue</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {pendingCount} pending · {doneCount} done
            </p>
          </div>
          {/* Auto-run toggle */}
          <button
            onClick={() => setAutoRun(v => !v)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              autoRun
                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
            }`}
            title="Toggle auto-run: automatically sends the next task when the current one finishes"
          >
            <span className={`w-2 h-2 rounded-full ${autoRun ? 'bg-green-500' : 'bg-gray-400'}`} />
            Auto-run {autoRun ? 'on' : 'off'}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-6">
              <span className="text-3xl mb-2">📋</span>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No tasks queued</p>
              <p className="text-xs text-gray-400 dark:text-gray-600 mt-1 max-w-xs">
                Add prompts below. They'll run one after another automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {tasks.map((task, idx) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 px-4 py-3 group transition-colors ${
                    task.status === 'running'
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : task.status === 'done'
                        ? 'bg-green-50/50 dark:bg-green-900/10 opacity-60'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  {/* Status indicator */}
                  <div className="flex-shrink-0 mt-0.5">
                    {task.status === 'running' ? (
                      <svg className="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                    ) : task.status === 'done' ? (
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : task.status === 'error' ? (
                      <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <span className="w-4 h-4 flex items-center justify-center text-xs font-bold text-gray-400 dark:text-gray-600">
                        {idx + 1}
                      </span>
                    )}
                  </div>

                  {/* Prompt text */}
                  <p className="flex-1 text-sm text-gray-700 dark:text-gray-300 leading-snug line-clamp-3">
                    {task.prompt}
                  </p>

                  {/* Remove button */}
                  {task.status !== 'running' && (
                    <button
                      onClick={() => removeTask(task.id)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center
                                 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all"
                      title="Remove"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add task input */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/60">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTask() }
              }}
              placeholder="Add a task prompt… (Enter to add)"
              rows={2}
              className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2
                         text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600
                         outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         resize-none transition-all"
            />
            <button
              onClick={addTask}
              disabled={!input.trim()}
              className="flex-shrink-0 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-medium transition-colors self-start mt-0"
            >
              Add
            </button>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              {/* Run next manually */}
              {pendingCount > 0 && !isStreaming && !autoRun && (
                <button
                  onClick={runNow}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                             bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Run next
                </button>
              )}
              {isStreaming && (
                <span className="flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Running…
                </span>
              )}
            </div>
            {doneCount > 0 && (
              <button
                onClick={clearDone}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Clear {doneCount} done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
