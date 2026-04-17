import { useState, useEffect, useCallback, useRef } from 'react'

interface FileChange {
  path: string
  type: string
  timestamp: number
}

interface Props {
  workspacePath: string | undefined
  isStreaming:   boolean
  onSuggest:    (prompt: string) => void
}

export default function PairModePanel({ workspacePath, isStreaming, onSuggest }: Props) {
  const [watching, setWatching]       = useState(false)
  const [recentChanges, setRecentChanges] = useState<FileChange[]>([])
  const [autoSuggest, setAutoSuggest] = useState(true)
  const lastSuggestRef = useRef(0)

  // Start/stop file watcher
  const toggleWatch = useCallback(async () => {
    if (!window.api || !workspacePath) return
    if (watching) {
      await window.api.stopFileWatch()
      setWatching(false)
    } else {
      const r = await window.api.startFileWatch(workspacePath)
      if (r.ok) setWatching(true)
    }
  }, [watching, workspacePath])

  // Start watching automatically when component mounts
  useEffect(() => {
    if (workspacePath && window.api) {
      window.api.startFileWatch(workspacePath).then(r => {
        if (r.ok) setWatching(true)
      })
    }
    return () => {
      if (window.api) window.api.stopFileWatch()
      setWatching(false)
    }
  }, [workspacePath])

  // Listen for file change events
  useEffect(() => {
    if (!window.api) return
    const handler = (payload: { changes: Array<{ path: string; type: string }> }) => {
      const now = Date.now()
      const newChanges = payload.changes.map(c => ({ ...c, timestamp: now }))
      setRecentChanges(prev => [...newChanges, ...prev].slice(0, 20))

      // Auto-suggest: ask AI about changes (debounced, at most once per 10s)
      if (autoSuggest && !isStreaming && now - lastSuggestRef.current > 10_000) {
        lastSuggestRef.current = now
        const files = payload.changes.map(c => c.path).join(', ')
        onSuggest(
          `The following files were just modified: ${files}\n\nPlease briefly review the changes — only point out likely bugs, missing imports, or issues. If everything looks fine, just say "Looks good." Keep it short.`
        )
      }
    }
    window.api.onFileWatchChange(handler)

    // No cleanup needed — IPC listeners are managed globally
  }, [autoSuggest, isStreaming, onSuggest])

  const timeAgo = (ts: number) => {
    const secs = Math.floor((Date.now() - ts) / 1000)
    if (secs < 5) return 'just now'
    if (secs < 60) return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    return `${Math.floor(secs / 3600)}h ago`
  }

  return (
    <div className="w-64 flex-shrink-0 border-l border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            Pair Mode
          </h3>
          <div className="flex items-center gap-1.5">
            {watching && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
            <span className="text-[10px] text-gray-400">{watching ? 'Watching' : 'Stopped'}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
        <button onClick={toggleWatch}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            watching
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100'
              : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100'
          }`}>
          {watching ? 'Stop' : 'Watch'}
        </button>
        <button
          onClick={() => setAutoSuggest(a => !a)}
          className={`px-2 py-1.5 text-xs rounded-lg transition-colors ${
            autoSuggest
              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
          }`}
          aria-label={autoSuggest ? 'Disable auto-suggestions' : 'Enable auto-suggestions'}
          title={autoSuggest ? 'Auto-suggest ON' : 'Auto-suggest OFF'}
        >
          Auto
        </button>
      </div>

      {/* Recent changes */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
          Recent changes
        </p>
        {recentChanges.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center mt-4">
            {watching ? 'Waiting for file changes...' : 'Start watching to see changes'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {recentChanges.map((c, idx) => (
              <div key={`${c.path}-${idx}`} className="flex items-center justify-between py-1">
                <span className="text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">{c.path}</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0">{timeAgo(c.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800">
        <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center">
          {autoSuggest ? 'AI reviews changes automatically' : 'Manual review only'}
        </p>
      </div>
    </div>
  )
}
