import { useState, useEffect, useRef } from 'react'
import { DevServerState, DevServerStatusPayload, DevServerLogPayload } from '../../../shared/types'

interface Props {
  workspacePath: string
  onClose:       () => void
}

interface LogLine {
  text:    string
  isError: boolean
  id:      number
}

let logId = 0

export default function LivePreviewPanel({ workspacePath, onClose }: Props) {
  const [state,    setState]    = useState<DevServerState>('stopped')
  const [url,      setUrl]      = useState<string | null>(null)
  const [logs,     setLogs]     = useState<LogLine[]>([])
  const [command,  setCommand]  = useState('')
  const [showCmd,  setShowCmd]  = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.onDevServerStatus((p: DevServerStatusPayload) => {
      setState(p.state)
      if (p.url) setUrl(p.url)
      if (p.state === 'stopped') setUrl(null)
    })
    window.api.onDevServerLog((p: DevServerLogPayload) => {
      setLogs(prev => [...prev.slice(-200), { text: p.line, isError: !!p.isError, id: ++logId }])
    })
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const start = () => {
    setLogs([])
    window.api.startDevServer({ workspacePath, command: command.trim() || undefined })
  }

  const stop = () => window.api.stopDevServer()

  const openInBrowser = () => {
    if (url) window.open(url, '_blank')
  }

  const stateColor =
    state === 'running'  ? 'text-green-600 dark:text-green-400' :
    state === 'starting' ? 'text-amber-600 dark:text-amber-400' :
    state === 'error'    ? 'text-red-600 dark:text-red-400' :
                           'text-gray-500 dark:text-gray-400'

  const stateDot =
    state === 'running'  ? 'bg-green-500' :
    state === 'starting' ? 'bg-amber-500 animate-pulse' :
    state === 'error'    ? 'bg-red-500' :
                           'bg-gray-400'

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/>
          </svg>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Live Preview</h2>
          <span className={`flex items-center gap-1.5 text-xs ${stateColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${stateDot}`}/>
            {state}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* URL bar */}
      {url && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-950/30 border-b border-green-200 dark:border-green-800 shrink-0">
          <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
          </svg>
          <span className="text-xs font-mono text-green-800 dark:text-green-300 flex-1 truncate">{url}</span>
          <button
            onClick={openInBrowser}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-600 hover:bg-green-700 text-white transition-colors shrink-0"
          >
            Open
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"/>
            </svg>
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-2 shrink-0">
        {showCmd && (
          <input
            value={command}
            onChange={e => setCommand(e.target.value)}
            placeholder="npm run dev (auto-detected if empty)"
            className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
        <div className="flex items-center gap-2">
          {state === 'stopped' || state === 'error' ? (
            <button
              onClick={start}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Start Dev Server
            </button>
          ) : (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:bg-red-200 transition-colors"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z"/>
              </svg>
              Stop
            </button>
          )}
          <button
            onClick={() => setShowCmd(s => !s)}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline"
          >
            {showCmd ? 'hide command' : 'custom command'}
          </button>
        </div>
      </div>

      {/* Log output */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-0.5 min-h-0">
        {logs.length === 0 ? (
          <p className="text-gray-400 dark:text-gray-500 italic text-xs p-2">No output yet. Start the dev server to see logs.</p>
        ) : (
          logs.map(log => (
            <div key={log.id} className={log.isError ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}>
              {log.text}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  )
}
