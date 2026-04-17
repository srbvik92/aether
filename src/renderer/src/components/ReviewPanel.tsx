import { useState, useEffect, useCallback } from 'react'

interface ChangeSummary {
  file:    string
  status:  'added' | 'modified' | 'deleted' | 'renamed'
  lines:   string  // "+3 -1" format
}

interface Props {
  workspacePath: string | undefined
  onReviewStart: (prompt: string) => void
  isStreaming:    boolean
}

function parseGitStatus(status: string): ChangeSummary[] {
  const files: ChangeSummary[] = []
  const lines = status.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s*([MADRCU?!]+)\s+(.+)/)
    if (match) {
      const code = match[1]
      const file = match[2].trim()
      const s: ChangeSummary['status'] =
        code.includes('A') || code.includes('?') ? 'added' :
        code.includes('D') ? 'deleted' :
        code.includes('R') ? 'renamed' : 'modified'
      files.push({ file, status: s, lines: '' })
    }
  }
  return files
}

function StatusBadge({ status }: { status: ChangeSummary['status'] }) {
  const colors = {
    added:    'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    modified: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    deleted:  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    renamed:  'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${colors[status]}`}>
      {status[0]}
    </span>
  )
}

export default function ReviewPanel({ workspacePath, onReviewStart, isStreaming }: Props) {
  const [changes, setChanges]   = useState<ChangeSummary[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [hasDiff, setHasDiff]   = useState(false)
  const [reviewed, setReviewed] = useState(false)

  const loadChanges = useCallback(async () => {
    if (!workspacePath || !window.api) return
    setLoading(true); setError('')
    try {
      const r = await window.api.getReviewChanges(workspacePath)
      if (r.ok) {
        const parsed = parseGitStatus(r.status ?? '')
        setChanges(parsed)
        setHasDiff(!!(r.diff?.trim() || r.staged?.trim()))
      } else {
        setError(r.error ?? 'Failed to load changes')
      }
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }, [workspacePath])

  useEffect(() => { loadChanges() }, [loadChanges])

  const handleReview = () => {
    setReviewed(true)
    onReviewStart(
      'Please review all my current code changes. Run git_status and git_diff to see everything, then review each changed file thoroughly. Focus on bugs, security issues, performance problems, and missing error handling. Rate the overall change and provide specific fix suggestions.'
    )
  }

  return (
    <div className="w-64 flex-shrink-0 border-l border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            Code Review
          </h3>
          <button onClick={loadChanges} disabled={loading}
            className="text-[10px] text-blue-500 hover:text-blue-600 disabled:opacity-50">
            {loading ? '...' : '\u21BB'}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
          {changes.length} file{changes.length !== 1 ? 's' : ''} changed
        </p>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        {changes.length === 0 && !loading && !error && (
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center mt-4">
            No uncommitted changes found.
          </p>
        )}
        <div className="flex flex-col gap-1">
          {changes.map((c, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs py-1">
              <StatusBadge status={c.status} />
              <span className="truncate text-gray-700 dark:text-gray-300 font-mono text-[11px]">{c.file}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Review button */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
        {hasDiff && !reviewed ? (
          <button
            onClick={handleReview}
            disabled={isStreaming || loading}
            className="w-full py-2 text-xs font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            Review my changes
          </button>
        ) : reviewed && isStreaming ? (
          <p className="text-xs text-blue-500 text-center font-medium animate-pulse">Reviewing...</p>
        ) : reviewed ? (
          <button
            onClick={() => { setReviewed(false); loadChanges() }}
            className="w-full py-2 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Review again
          </button>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center">No changes to review</p>
        )}
      </div>
    </div>
  )
}
