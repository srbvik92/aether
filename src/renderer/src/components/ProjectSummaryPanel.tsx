import { useState, useEffect, useCallback } from 'react'

interface Props {
  workspacePath: string
  onClose:       () => void
  /** Called when the user clicks "Ask AI to generate" — sends a prefilled message */
  onRequestGenerate: () => void
}

// Export format configs
const EXPORT_FORMATS = [
  {
    id:    'claude',
    label: 'Claude.ai / Claude Code',
    icon:  '🟠',
    wrap:  (content: string) =>
      `I'm continuing work on an existing project. Here is the current project context:\n\n${content}\n\nPlease review this and let me know you're ready to help.`
  },
  {
    id:    'cursor',
    label: 'Cursor / Windsurf',
    icon:  '🖱️',
    wrap:  (content: string) =>
      `# Project Context\n\nPaste this into your first message or as a note.\n\n${content}`
  },
  {
    id:    'chatgpt',
    label: 'ChatGPT / Codex',
    icon:  '🟢',
    wrap:  (content: string) =>
      `I want you to help me work on a software project. Here is the full context document:\n\n${content}\n\nUse this to understand the codebase before I give you tasks.`
  },
  {
    id:    'raw',
    label: 'Raw Markdown',
    icon:  '📄',
    wrap:  (content: string) => content
  }
]

export default function ProjectSummaryPanel({ workspacePath, onClose, onRequestGenerate }: Props) {
  const [content,   setContent]   = useState('')
  const [updatedAt, setUpdatedAt] = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [copied,    setCopied]    = useState<string | null>(null)   // format id that was just copied
  const [error,     setError]     = useState<string | null>(null)

  const isElectron = typeof window !== 'undefined' && !!window.api

  // Load summary on mount
  useEffect(() => {
    if (!isElectron || !workspacePath) { setLoading(false); return }
    window.api.readSummary(workspacePath).then(({ content, updatedAt }) => {
      setContent(content)
      setUpdatedAt(updatedAt)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [workspacePath])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleCopy = useCallback(async (formatId: string) => {
    const fmt = EXPORT_FORMATS.find(f => f.id === formatId)
    if (!fmt || !content.trim()) return
    const stripped = content.replace(/^<!--.*?-->\n?/, '')
    await navigator.clipboard.writeText(fmt.wrap(stripped))
    setCopied(formatId)
    setTimeout(() => setCopied(null), 2000)
  }, [content])

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Delete the project summary? The AI will regenerate it after the next coding task.')) return
    if (!isElectron || !workspacePath) return
    await window.api.saveSummary(workspacePath, '')
    setContent('')
    setUpdatedAt(0)
  }, [workspacePath])

  const strippedContent = content.replace(/^<!--.*?-->\n?/, '').trim()
  const hasContent = strippedContent.length > 0

  const relativeTime = updatedAt > 0
    ? (() => {
        const diff = Date.now() - updatedAt
        if (diff < 60_000)    return 'just now'
        if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
        if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
        return new Date(updatedAt).toLocaleDateString()
      })()
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[720px] max-w-[94vw] max-h-[85vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="text-xl leading-none">📄</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Project Summary</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Auto-maintained by the AI · copy to switch to any other tool instantly
              {relativeTime && (
                <span className="ml-2 text-green-500">· updated {relativeTime}</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              Loading…
            </div>

          ) : !hasContent ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-64 gap-4 px-8 text-center">
              <div className="text-4xl">🗺️</div>
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  No project summary yet
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 max-w-sm">
                  The AI will automatically generate one after your first coding session.
                  Or ask it to generate one now.
                </p>
              </div>
              <button
                onClick={() => { onRequestGenerate(); onClose() }}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Ask AI to generate now
              </button>
            </div>

          ) : (
            /* Summary content */
            <pre className="px-5 py-4 text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {strippedContent}
            </pre>
          )}
        </div>

        {/* ── Export / copy buttons ───────────────────────────────────────── */}
        {hasContent && (
          <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-5 py-3 bg-gray-50 dark:bg-gray-900/50">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 font-medium uppercase tracking-wide">
              Copy formatted for…
            </p>
            <div className="flex flex-wrap gap-2">
              {EXPORT_FORMATS.map(fmt => (
                <button
                  key={fmt.id}
                  onClick={() => handleCopy(fmt.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
                    ${copied === fmt.id
                      ? 'bg-green-50 dark:bg-green-900/30 border-green-400 dark:border-green-600 text-green-700 dark:text-green-300'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400'
                    }`}
                >
                  <span>{fmt.icon}</span>
                  {copied === fmt.id ? '✓ Copied!' : fmt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
          <p className="text-[11px] text-gray-400 dark:text-gray-600">
            Saved to <code className="font-mono">.ai-context/PROJECT.md</code> in your workspace
            {hasContent && ' · commit this file to share context with your team'}
          </p>
          <div className="flex items-center gap-3">
            {error && <span className="text-[11px] text-red-500">{error}</span>}
            {hasContent && (
              <>
                <button
                  onClick={() => { onRequestGenerate(); onClose() }}
                  className="text-[11px] text-blue-500 hover:text-blue-600 transition-colors"
                >
                  Regenerate
                </button>
                <button
                  onClick={handleDelete}
                  className="text-[11px] text-red-400 hover:text-red-600 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
