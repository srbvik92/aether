import { useState, useEffect, useCallback } from 'react'

interface ChangeSummary {
  file:      string
  status:    'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

interface Props {
  workspacePath: string | undefined
  onReviewStart: (prompt: string) => void
  isStreaming:    boolean
}

// ── Parse git diff --stat output ──────────────────────────────────────────────
function parseDiffStat(diff: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>()
  const lines = diff.split('\n')
  for (const line of lines) {
    // Format: "+++ b/path/to/file" or "@@ ... @@" context lines
    // We use the simpler approach: count +/- lines per file
    const fileMatch = line.match(/^\+\+\+ b\/(.+)/)
    if (fileMatch) {
      stats.set(fileMatch[1], { additions: 0, deletions: 0 })
    }
  }
  // Second pass: count actual +/- lines
  let currentFile = ''
  for (const line of lines) {
    const fm = line.match(/^\+\+\+ b\/(.+)/)
    if (fm) { currentFile = fm[1]; continue }
    if (!currentFile) continue
    const s = stats.get(currentFile)
    if (!s) continue
    if (line.startsWith('+') && !line.startsWith('+++')) s.additions++
    else if (line.startsWith('-') && !line.startsWith('---')) s.deletions++
  }
  return stats
}

function parseGitStatusWithDiff(status: string, diff: string, staged: string): ChangeSummary[] {
  const files: ChangeSummary[] = []
  const statsByFile = new Map([...parseDiffStat(diff), ...parseDiffStat(staged)])

  const lines = [
    ...(status?.split(' | ').length > 1 ? [] : [status]),
  ]

  // Parse from diff headers directly — more reliable
  const allDiffs = diff + '\n' + staged
  const fileEntries = new Set<string>()
  const headerRe = /^diff --git a\/(.+?) b\/(.+)/mg
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(allDiffs)) !== null) {
    fileEntries.add(m[2])
  }

  // Also parse from git status compact format
  const statusLines = (status || '').split('\n')
  for (const line of statusLines) {
    const match = line.match(/^\s*([MADRCU?! ]{1,2})\s+(.+)/)
    if (!match) continue
    const code = match[1].trim()
    const file = match[2].trim().replace(/^"/, '').replace(/"$/, '')
    fileEntries.add(file)
    const s: ChangeSummary['status'] =
      code.includes('A') ? 'added' :
      code.includes('D') ? 'deleted' :
      code.includes('R') ? 'renamed' :
      code.includes('?') ? 'added' : 'modified'
    const st = statsByFile.get(file) ?? { additions: 0, deletions: 0 }
    files.push({ file, status: s, ...st })
  }

  // Fill in any files from diffs not already listed
  for (const f of fileEntries) {
    if (!files.find(x => x.file === f)) {
      const st = statsByFile.get(f) ?? { additions: 0, deletions: 0 }
      files.push({ file: f, status: 'modified', ...st })
    }
  }

  return files
}

function StatusBadge({ status }: { status: ChangeSummary['status'] }) {
  const cfg: Record<ChangeSummary['status'], { cls: string; label: string }> = {
    added:    { cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',    label: 'A' },
    modified: { cls: 'bg-blue-100  dark:bg-blue-900/30  text-blue-700  dark:text-blue-300',     label: 'M' },
    deleted:  { cls: 'bg-red-100   dark:bg-red-900/30   text-red-700   dark:text-red-300',      label: 'D' },
    renamed:  { cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300', label: 'R' },
  }
  const { cls, label } = cfg[status]
  return (
    <span className={`text-[9px] w-4 h-4 rounded flex items-center justify-center font-bold flex-shrink-0 ${cls}`}>
      {label}
    </span>
  )
}

function DiffStatBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions
  if (total === 0) return null
  const pct = Math.round((additions / total) * 100)
  return (
    <div className="flex items-center gap-1 text-[9px]">
      <span className="text-green-600 dark:text-green-400 font-medium">+{additions}</span>
      <div className="w-8 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-red-500 dark:text-red-400 font-medium">-{deletions}</span>
    </div>
  )
}

export default function ReviewPanel({ workspacePath, onReviewStart, isStreaming }: Props) {
  const [changes,    setChanges]    = useState<ChangeSummary[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [hasDiff,    setHasDiff]    = useState(false)
  const [reviewed,   setReviewed]   = useState(false)
  const [diffRaw,    setDiffRaw]    = useState('')
  const [showDiff,   setShowDiff]   = useState(false)
  const [branch,     setBranch]     = useState('')
  const [reviewType, setReviewType] = useState<'full' | 'security' | 'performance' | 'quick'>('full')

  // Total stats
  const totalAdd = changes.reduce((n, c) => n + c.additions, 0)
  const totalDel = changes.reduce((n, c) => n + c.deletions, 0)

  const loadChanges = useCallback(async () => {
    if (!workspacePath || !window.api) return
    setLoading(true); setError('')
    try {
      const r = await window.api.getReviewChanges(workspacePath)
      if (r.ok) {
        const parsed = parseGitStatusWithDiff(r.status ?? '', r.diff ?? '', r.staged ?? '')
        setChanges(parsed)
        setHasDiff(!!(r.diff?.trim() || r.staged?.trim()))
        setDiffRaw((r.staged?.trim() ? r.staged : '') + '\n' + (r.diff?.trim() ? r.diff : ''))
        // Extract branch from status string
        const branchMatch = (r.status ?? '').match(/Branch: ([^\s|]+)/)
        if (branchMatch) setBranch(branchMatch[1])
      } else {
        setError(r.error ?? 'Failed to load changes')
      }
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }, [workspacePath])

  useEffect(() => { loadChanges() }, [loadChanges])

  const REVIEW_PROMPTS: Record<typeof reviewType, string> = {
    full:
      'Please do a thorough code review of all my current changes. ' +
      'Run git_diff to read the actual changes, then for each changed file: ' +
      '1) Summarise what changed and why, ' +
      '2) Flag any bugs, edge-cases, or logic errors, ' +
      '3) Check for security issues (injections, auth bypasses, data leaks), ' +
      '4) Note performance concerns or inefficiencies, ' +
      '5) Point out missing error handling or tests. ' +
      'Rate the overall change quality (1–10) and give specific actionable fix suggestions.',
    security:
      'Focus ONLY on security issues in my current code changes. ' +
      'Run git_diff, then audit for: SQL injection, XSS, CSRF, insecure dependencies, ' +
      'hardcoded secrets, improper auth/authz, unsafe deserialization, path traversal, ' +
      'and any OWASP Top 10 violations. For each issue found, explain the risk and show the fix.',
    performance:
      'Focus ONLY on performance issues in my current code changes. ' +
      'Run git_diff, then look for: N+1 queries, missing indexes, expensive loops, ' +
      'unnecessary re-renders (if React), blocking I/O, large bundle additions, ' +
      'and any algorithmic complexity regressions. Show specific optimisation suggestions.',
    quick:
      'Quick scan of my changes — run git_diff and give me a 5-bullet summary: ' +
      'what changed, any obvious bugs, any risky lines, test coverage gap, and your overall verdict. ' +
      'Keep it under 200 words.'
  }

  const handleReview = () => {
    setReviewed(true)
    onReviewStart(REVIEW_PROMPTS[reviewType])
  }

  if (!workspacePath) {
    return (
      <div className="w-64 flex-shrink-0 border-l border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex flex-col items-center justify-center p-6 gap-3">
        <span className="text-3xl opacity-30">📋</span>
        <p className="text-xs text-gray-400 dark:text-gray-600 text-center">
          Set a workspace folder to enable code review.
        </p>
      </div>
    )
  }

  return (
    <div className="w-64 flex-shrink-0 border-l border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex flex-col overflow-hidden">

      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            </svg>
            Code Review
          </h3>
          <button onClick={loadChanges} disabled={loading}
            className="text-[10px] text-blue-500 hover:text-blue-600 disabled:opacity-50 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded px-1 py-0.5 transition-colors">
            {loading ? '…' : '↺'}
          </button>
        </div>

        {/* Branch + stats */}
        {branch && (
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 mb-1">
            <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 7.5h-.75A2.25 2.25 0 004.5 9.75v7.5a2.25 2.25 0 002.25 2.25h7.5a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25h-.75m0-3l-3-3m0 0l-3 3m3-3v11.25m6-2.25h.75a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-7.5a2.25 2.25 0 01-2.25-2.25v-.75" />
            </svg>
            <span className="font-mono truncate">{branch}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-500">{changes.length} file{changes.length !== 1 ? 's' : ''}</span>
          {(totalAdd > 0 || totalDel > 0) && (
            <>
              <span className="text-green-600 dark:text-green-400 font-medium">+{totalAdd}</span>
              <span className="text-red-500 dark:text-red-400 font-medium">-{totalDel}</span>
            </>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {error && (
          <div className="text-[11px] text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2 mb-2">{error}</div>
        )}
        {changes.length === 0 && !loading && !error && (
          <div className="text-center mt-6">
            <p className="text-2xl opacity-20 mb-2">✓</p>
            <p className="text-xs text-gray-400 dark:text-gray-600">
              No uncommitted changes found.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {changes.map((c, idx) => (
            <div key={idx} className="flex items-start gap-1.5 py-1 group">
              <StatusBadge status={c.status} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate leading-tight" title={c.file}>
                  {c.file}
                </p>
                <DiffStatBar additions={c.additions} deletions={c.deletions} />
              </div>
            </div>
          ))}
        </div>

        {/* Raw diff toggle */}
        {hasDiff && (
          <button
            onClick={() => setShowDiff(v => !v)}
            className="mt-3 w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-[10px] text-gray-500 dark:text-gray-400"
          >
            <span>{showDiff ? 'Hide raw diff' : 'Show raw diff'}</span>
            <svg className={`w-3 h-3 transition-transform ${showDiff ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
        {showDiff && diffRaw && (
          <pre className="mt-2 text-[9px] font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre leading-relaxed">
            {diffRaw.slice(0, 4000)}{diffRaw.length > 4000 ? '\n…' : ''}
          </pre>
        )}
      </div>

      {/* Review controls */}
      <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-2">
        {hasDiff && !reviewed && (
          <>
            {/* Review type selector */}
            <div className="grid grid-cols-2 gap-1">
              {(['full', 'quick', 'security', 'performance'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setReviewType(t)}
                  className={`py-1 text-[10px] rounded-md font-medium capitalize transition-colors ${
                    reviewType === t
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              onClick={handleReview}
              disabled={isStreaming || loading}
              className="w-full py-2 text-xs font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Review ({reviewType})
            </button>
          </>
        )}
        {reviewed && isStreaming && (
          <p className="text-xs text-blue-500 text-center font-medium animate-pulse py-1">
            Reviewing…
          </p>
        )}
        {reviewed && !isStreaming && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] text-green-600 dark:text-green-400 text-center font-medium">
              ✓ Review complete
            </p>
            <button
              onClick={() => { setReviewed(false); loadChanges() }}
              className="w-full py-1.5 text-[11px] font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Review again
            </button>
          </div>
        )}
        {!hasDiff && !loading && (
          <p className="text-[10px] text-gray-400 dark:text-gray-600 text-center">No changes to review</p>
        )}
      </div>
    </div>
  )
}
