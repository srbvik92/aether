import { useState, useCallback } from 'react'
import { AuditResult, AuditVulnerability, AuditSeverity } from '../../../shared/types'

// ── Helpers ────────────────────────────────────────────────────────────────────
const SEV_ORDER: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info']

const SEV_STYLE: Record<AuditSeverity, { bg: string; text: string; badge: string }> = {
  critical: {
    bg:    'bg-red-50 dark:bg-red-900/20',
    text:  'text-red-700 dark:text-red-300',
    badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700',
  },
  high: {
    bg:    'bg-orange-50 dark:bg-orange-900/20',
    text:  'text-orange-700 dark:text-orange-300',
    badge: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700',
  },
  moderate: {
    bg:    'bg-yellow-50 dark:bg-yellow-900/20',
    text:  'text-yellow-700 dark:text-yellow-300',
    badge: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
  },
  low: {
    bg:    'bg-blue-50 dark:bg-blue-900/20',
    text:  'text-blue-700 dark:text-blue-300',
    badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  },
  info: {
    bg:    'bg-gray-50 dark:bg-gray-800/50',
    text:  'text-gray-600 dark:text-gray-400',
    badge: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700',
  },
}

function SevBadge({ sev }: { sev: AuditSeverity }) {
  const s = SEV_STYLE[sev]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${s.badge}`}>
      {sev}
    </span>
  )
}

function SummaryBar({ result }: { result: AuditResult }) {
  const total = result.total
  if (total === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800">
        <span className="text-green-600 dark:text-green-400 text-sm font-medium">✓ No vulnerabilities found</span>
        <span className="text-xs text-green-500 dark:text-green-500">({result.manager} audit)</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-wrap">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {total} {total === 1 ? 'vulnerability' : 'vulnerabilities'}
      </span>
      {SEV_ORDER.map(sev => {
        const count = result[sev]
        if (!count) return null
        return <SevBadge key={sev} sev={sev} />
      })}
      <span className="text-xs text-gray-400 ml-auto">via {result.manager}</span>
    </div>
  )
}

function VulnRow({ v, onAskAI }: { v: AuditVulnerability; onAskAI?: (prompt: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const s = SEV_STYLE[v.severity]

  return (
    <div className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${expanded ? s.bg : ''}`}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">{v.name}</span>
            <SevBadge sev={v.severity} />
            {v.isDirect && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700">
                direct
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{v.title}</p>
        </div>
        {v.fixedIn && (
          <span className="flex-shrink-0 text-[11px] text-green-600 dark:text-green-400">
            Fix: {v.fixedIn}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 ml-6">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
            {v.range && (
              <div className="flex gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-400 w-20 flex-shrink-0">Vulnerable</span>
                <span className="font-mono text-red-600 dark:text-red-400">{v.range}</span>
              </div>
            )}
            {v.fixedIn && (
              <div className="flex gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-400 w-20 flex-shrink-0">Fixed in</span>
                <span className="font-mono text-green-600 dark:text-green-400">{v.fixedIn}</span>
              </div>
            )}
            {v.via.length > 0 && (
              <div className="flex gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-gray-400 w-20 flex-shrink-0">Via</span>
                <span className="font-mono text-gray-600 dark:text-gray-300">{v.via.join(' → ')}</span>
              </div>
            )}
            {v.url && (
              <div className="flex gap-2 px-3 py-2">
                <span className="text-gray-400 w-20 flex-shrink-0">Advisory</span>
                <a
                  href={v.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 hover:underline truncate"
                  onClick={e => e.stopPropagation()}
                >
                  {v.url}
                </a>
              </div>
            )}
          </div>
          {onAskAI && (
            <button
              type="button"
              onClick={() => onAskAI(
                `I have a vulnerability in my project:\n\nPackage: ${v.name}\nSeverity: ${v.severity}\nTitle: ${v.title}\nVulnerable range: ${v.range}\nFixed in: ${v.fixedIn}\n\nHow should I fix this? What's the recommended approach?`
              )}
              className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-purple-600 hover:bg-purple-500 text-white transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Ask AI to fix
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
interface Props {
  workspacePath: string
  onClose: () => void
  onAskAI?: (prompt: string) => void
}

export default function DependencyAuditPanel({ workspacePath, onClose, onAskAI }: Props) {
  const [result,     setResult]     = useState<AuditResult | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [filterSev,  setFilterSev]  = useState<AuditSeverity | 'all'>('all')
  const [showRaw,    setShowRaw]    = useState(false)

  const runAudit = useCallback(async () => {
    if (!workspacePath) {
      setError('No workspace path configured. Set one in Settings → Workspace.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await window.api.runDepAudit(workspacePath)
      if (res.ok && res.result) {
        setResult(res.result)
      } else {
        setError(res.error ?? 'Audit failed')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  const filtered = result
    ? (filterSev === 'all' ? result.vulns : result.vulns.filter(v => v.severity === filterSev))
    : []

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Title bar */}
      <div
        className="h-9 flex items-center px-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <span>🔍</span> Dependency Audit
        </span>
        <div className="flex items-center gap-2 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {result && onAskAI && (
            <button
              type="button"
              onClick={() => onAskAI(
                `Here's my dependency audit report (${result.manager}):\n\n` +
                `Total: ${result.total} vulnerabilities (${result.critical} critical, ${result.high} high, ${result.moderate} moderate, ${result.low} low)\n\n` +
                `Please help me prioritize and fix the most critical issues.\n\n` +
                `Raw output:\n${result.raw.slice(0, 3000)}`
              )}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-purple-600 hover:bg-purple-500 text-white transition-colors"
            >Ask AI</button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 truncate min-w-0">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="truncate">{workspacePath || 'No workspace'}</span>
        </div>
        <button
          type="button"
          onClick={runAudit}
          disabled={loading || !workspacePath}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors flex-shrink-0"
        >
          {loading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {loading ? 'Running…' : 'Run Audit'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!result && !error && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-3xl">🔍</div>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Scan for vulnerabilities</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Runs <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">npm audit</code>,{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">cargo audit</code>, or{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">pip-audit</code> depending on your project.
              </p>
            </div>
            <button
              type="button"
              onClick={runAudit}
              disabled={!workspacePath}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              Run Audit
            </button>
            {!workspacePath && (
              <p className="text-xs text-orange-500 dark:text-orange-400">
                Set a workspace in Settings → Workspace first.
              </p>
            )}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <svg className="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">Running audit…</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">This may take a minute for large dependency trees</p>
          </div>
        )}

        {error && (
          <div className="m-4 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">Audit failed</p>
            <p className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap">{error}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={runAudit}
                className="px-3 py-1.5 rounded-lg text-xs bg-red-600 hover:bg-red-500 text-white transition-colors"
              >Retry</button>
              {onAskAI && (
                <button
                  type="button"
                  onClick={() => onAskAI(`I'm getting an error running the dependency audit:\n\n${error}\n\nHow can I fix this?`)}
                  className="px-3 py-1.5 rounded-lg text-xs bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                >Ask AI</button>
              )}
            </div>
          </div>
        )}

        {result && (
          <>
            <SummaryBar result={result} />

            {/* Severity filter */}
            {result.total > 0 && (
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
                {(['all', ...SEV_ORDER] as const).map(sev => {
                  const count = sev === 'all' ? result.total : result[sev]
                  if (sev !== 'all' && !count) return null
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setFilterSev(sev)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        filterSev === sev
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {sev === 'all' ? `All (${count})` : `${sev} (${count})`}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setShowRaw(r => !r)}
                  className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showRaw ? 'Show list' : 'Raw output'}
                </button>
              </div>
            )}

            {showRaw ? (
              <pre className="p-4 text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                {result.raw}
              </pre>
            ) : (
              <div>
                {filtered.length === 0 && filterSev !== 'all' && (
                  <p className="px-4 py-8 text-center text-sm text-gray-400">No {filterSev} vulnerabilities.</p>
                )}
                {filtered.map((v, i) => (
                  <VulnRow key={i} v={v} onAskAI={onAskAI} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
