import { useState, useEffect, useCallback, useRef } from 'react'

interface LogEntry {
  ts:     string
  level:  string
  tag:    string
  msg:    string
  data?:  unknown
}

interface Props {
  onClose: () => void
}

const LEVEL_STYLES: Record<string, string> = {
  ERROR: 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',
  WARN:  'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-800',
  INFO:  'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900',
  DEBUG: 'text-gray-500 dark:text-gray-500 bg-transparent border-transparent',
}

const LEVEL_BADGE: Record<string, string> = {
  ERROR: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
  WARN:  'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400',
  INFO:  'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400',
  DEBUG: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-500',
}

const isElectron = typeof window !== 'undefined' && !!window.api

export default function LogViewerPanel({ onClose }: Props) {
  const [entries,    setEntries]    = useState<LogEntry[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [search,     setSearch]     = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('ALL')
  const [logPath,    setLogPath]    = useState<string>('')
  const [copied,     setCopied]     = useState(false)
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!isElectron) return
    setLoading(true)
    setError(null)
    try {
      const [result, path] = await Promise.all([
        window.api.readLogs(1000),
        window.api.getLogPath(),
      ])
      if (result.ok) {
        setEntries(result.entries as LogEntry[])
      } else {
        setError(result.error ?? 'Failed to read logs')
      }
      setLogPath(path)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = entries.filter(e => {
    const matchLevel = levelFilter === 'ALL' || e.level === levelFilter
    const q = search.toLowerCase()
    const matchSearch = !q || e.msg.toLowerCase().includes(q) || e.tag.toLowerCase().includes(q) ||
      (e.data ? JSON.stringify(e.data).toLowerCase().includes(q) : false)
    return matchLevel && matchSearch
  })

  const errorCount = entries.filter(e => e.level === 'ERROR').length
  const warnCount  = entries.filter(e => e.level === 'WARN').length

  const copyAll = async () => {
    const text = filtered.map(e =>
      `[${e.ts}] [${e.level}] [${e.tag}] ${e.msg}${e.data ? '\n  ' + JSON.stringify(e.data, null, 2) : ''}`
    ).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleExpand = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch { return ts }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Application Logs</h2>
            {/* Error/warn summary badges */}
            {errorCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400">
                {errorCount} error{errorCount !== 1 ? 's' : ''}
              </span>
            )}
            {warnCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400">
                {warnCount} warn{warnCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh */}
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              title="Refresh logs"
            >
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {/* Copy */}
            <button
              onClick={copyAll}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Copy filtered logs to clipboard"
            >
              {copied
                ? <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              }
            </button>
            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Close (Esc)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-950/50">
          {/* Search */}
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search messages, tags…"
              className="flex-1 bg-transparent text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {/* Level filter pills */}
          <div className="flex gap-1">
            {(['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const).map(lvl => (
              <button
                key={lvl}
                onClick={() => setLevelFilter(lvl)}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                  levelFilter === lvl
                    ? lvl === 'ALL'   ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900'
                    : lvl === 'ERROR' ? 'bg-red-500 text-white'
                    : lvl === 'WARN'  ? 'bg-yellow-500 text-white'
                    : lvl === 'INFO'  ? 'bg-blue-500 text-white'
                    :                   'bg-gray-500 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <span className="text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0">
            {filtered.length} / {entries.length}
          </span>
        </div>

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto font-mono text-xs">
          {loading && (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <svg className="w-4 h-4 animate-spin mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Loading logs…
            </div>
          )}

          {!loading && error && (
            <div className="m-4 p-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs">
              <strong>Failed to load logs:</strong> {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-xs">{entries.length === 0 ? 'No log entries yet' : 'No entries match your filter'}</p>
            </div>
          )}

          {!loading && !error && filtered.map((entry, idx) => {
            const isExpanded = expanded.has(idx)
            const hasData = entry.data !== undefined && entry.data !== null
            const dataStr = hasData ? JSON.stringify(entry.data, null, 2) : ''
            const isError = entry.level === 'ERROR'
            const isWarn  = entry.level === 'WARN'

            return (
              <div
                key={idx}
                className={`border-b border-gray-100 dark:border-gray-800/60 px-4 py-1.5 ${
                  isError ? 'bg-red-50/60 dark:bg-red-950/20' :
                  isWarn  ? 'bg-yellow-50/60 dark:bg-yellow-950/20' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  {/* Time */}
                  <span className="text-gray-400 dark:text-gray-600 flex-shrink-0 w-20 text-right">
                    {formatTime(entry.ts)}
                  </span>

                  {/* Level badge */}
                  <span className={`flex-shrink-0 px-1.5 py-0 rounded text-[9px] font-bold uppercase w-12 text-center ${LEVEL_BADGE[entry.level] ?? LEVEL_BADGE.DEBUG}`}>
                    {entry.level}
                  </span>

                  {/* Tag */}
                  <span className="flex-shrink-0 text-purple-500 dark:text-purple-400 w-20 truncate" title={entry.tag}>
                    [{entry.tag}]
                  </span>

                  {/* Message */}
                  <span className={`flex-1 min-w-0 break-words ${
                    isError ? 'text-red-700 dark:text-red-300' :
                    isWarn  ? 'text-yellow-700 dark:text-yellow-300' :
                    'text-gray-700 dark:text-gray-300'
                  }`}>
                    {entry.msg}
                  </span>

                  {/* Expand data button */}
                  {hasData && (
                    <button
                      onClick={() => toggleExpand(idx)}
                      className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title={isExpanded ? 'Hide data' : 'Show data'}
                    >
                      <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Expanded data */}
                {hasData && isExpanded && (
                  <pre className="mt-1.5 ml-[6.5rem] p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] overflow-x-auto whitespace-pre-wrap break-words">
                    {dataStr}
                  </pre>
                )}
              </div>
            )
          })}

          <div ref={bottomRef} />
        </div>

        {/* Footer — log file path */}
        {logPath && (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/50 flex-shrink-0">
            <p className="text-[10px] text-gray-400 dark:text-gray-600 truncate" title={logPath}>
              <span className="text-gray-500 dark:text-gray-500 font-medium">Log file: </span>{logPath}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
