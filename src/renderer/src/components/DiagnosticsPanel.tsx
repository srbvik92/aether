import { useState, useEffect } from 'react'

interface Props {
  workspacePath: string
  isDark: boolean
}

export default function DiagnosticsPanel({ workspacePath, isDark: _isDark }: Props) {
  const [open,     setOpen]     = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<{ errors: number; warnings: number; summary?: string } | null>(null)
  const [lastRun,  setLastRun]  = useState<Date | null>(null)

  const run = async () => {
    if (!workspacePath) return
    setLoading(true)
    try {
      const r = await window.api.getDiagnostics(workspacePath)
      setResult(r)
      setLastRun(new Date())
    } finally {
      setLoading(false)
    }
  }

  // Auto-run on mount if workspace is set
  useEffect(() => {
    if (workspacePath) run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  const errorCount   = result?.errors   ?? 0
  const warningCount = result?.warnings ?? 0
  const hasIssues    = errorCount > 0 || warningCount > 0
  const badgeClass   = errorCount > 0
    ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
    : warningCount > 0
    ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
    : 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800'

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
        </svg>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 flex-1">Diagnostics</span>
        {result && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${badgeClass}`}>
            {errorCount > 0 ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : warningCount > 0 ? `${warningCount} warning${warningCount !== 1 ? 's' : ''}` : '✓ clean'}
          </span>
        )}
        <button
          onClick={e => { e.stopPropagation(); run() }}
          disabled={loading}
          className="ml-1 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Re-run diagnostics"
        >
          <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
          </svg>
        </button>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-3 pb-3 max-h-48 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 py-2">Running diagnostics…</div>
          ) : result ? (
            <pre className={`text-[10px] font-mono whitespace-pre-wrap leading-relaxed ${
              hasIssues ? 'text-gray-800 dark:text-gray-200' : 'text-green-700 dark:text-green-400'
            }`}>
              {result.summary ?? (hasIssues ? `${errorCount} errors, ${warningCount} warnings` : '✅ No issues found')}
            </pre>
          ) : (
            <div className="text-xs text-gray-400 py-2">Click refresh to run diagnostics</div>
          )}
          {lastRun && (
            <div className="text-[10px] text-gray-400 mt-1">Last run: {lastRun.toLocaleTimeString()}</div>
          )}
        </div>
      )}
    </div>
  )
}
