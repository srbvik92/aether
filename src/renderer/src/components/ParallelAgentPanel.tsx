import { useState } from 'react'
import { useParallelAgent, TaskState } from '../hooks/useParallelAgent'
import { AppSettings } from '../../../shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  conversationId: string
  settings:       AppSettings
  workspacePath?: string
  onClose:        () => void
}

function genId() {
  return Math.random().toString(36).slice(2)
}

function TaskCard({ task }: { task: TaskState }) {
  const statusColor =
    task.status === 'done'
      ? 'border-green-300 dark:border-green-700'
      : task.status === 'error'
        ? 'border-red-300 dark:border-red-700'
        : task.status === 'streaming'
          ? 'border-blue-300 dark:border-blue-700'
          : 'border-gray-200 dark:border-gray-700'

  const statusDot =
    task.status === 'done'
      ? 'bg-green-500'
      : task.status === 'error'
        ? 'bg-red-500'
        : task.status === 'streaming'
          ? 'bg-blue-500 animate-pulse'
          : 'bg-gray-400'

  return (
    <div
      className={`flex flex-col rounded-xl border ${statusColor} bg-white dark:bg-gray-900 overflow-hidden`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">
          {task.title}
        </span>
        <span className="text-[10px] text-gray-400 capitalize">{task.status}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 min-h-0 max-h-64 text-xs">
        {task.status === 'error' ? (
          <p className="text-red-600 dark:text-red-400">{task.error}</p>
        ) : task.content ? (
          <div className="prose prose-xs dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.content}</ReactMarkdown>
          </div>
        ) : (
          <span className="text-gray-400 italic">
            {task.status === 'pending' ? 'Waiting to start…' : 'Starting…'}
          </span>
        )}
      </div>
    </div>
  )
}

export default function ParallelAgentPanel({
  conversationId,
  settings,
  workspacePath,
  onClose,
}: Props) {
  const [input, setInput] = useState('')
  const { tasks, isRunning, autoTriggered, runParallel, abort, clear } = useParallelAgent(
    conversationId,
    settings,
    workspacePath,
  )

  const handleRun = async () => {
    const lines = input
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
    if (lines.length < 2) return
    const parallelTasks = lines.map(line => ({ id: genId(), title: line, prompt: line }))
    await runParallel(parallelTasks)
  }

  const allDone =
    tasks.length > 0 && tasks.every(t => t.status === 'done' || t.status === 'error')

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-purple-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
            />
          </svg>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Parallel Agents
          </h2>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* LLM-triggered banner */}
      {autoTriggered && tasks.length > 0 && (
        <div className="px-4 py-2 bg-purple-50 dark:bg-purple-950/30 border-b border-purple-200 dark:border-purple-800">
          <p className="text-xs text-purple-700 dark:text-purple-300 font-medium">
            AI spawned sub-agents automatically
          </p>
        </div>
      )}

      {/* Input area (shown when no tasks yet and not auto-triggered) */}
      {tasks.length === 0 && !autoTriggered && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Enter 2–4 independent tasks, one per line. Each runs as a separate AI agent
            simultaneously.
          </p>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={5}
            placeholder={
              'Write unit tests for the auth module\nRefactor the database connection pool\nUpdate the README with setup instructions'
            }
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
          />
          <button
            onClick={handleRun}
            disabled={input.split('\n').filter(l => l.trim()).length < 2}
            className="w-full py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white transition-colors"
          >
            Run in Parallel
          </button>
        </div>
      )}

      {/* Task cards grid */}
      {tasks.length > 0 && (
        <div
          className="flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-3 min-h-0"
          style={{
            gridTemplateColumns: tasks.length >= 2 ? 'repeat(2, 1fr)' : '1fr',
          }}
        >
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Footer controls */}
      {tasks.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          {isRunning ? (
            <button
              onClick={abort}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:bg-red-200 transition-colors"
            >
              Stop All
            </button>
          ) : (
            <>
              {allDone && (
                <div className="flex-1 text-xs text-center text-green-600 dark:text-green-400 py-2">
                  All tasks complete
                </div>
              )}
              <button
                onClick={clear}
                className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
