import { useState, useEffect, useRef, useCallback } from 'react'

interface Props {
  workspacePath?: string   // not required when global=true
  global?:        boolean  // if true, reads/writes global memory instead of project memory
  onClose:        () => void
}

const PROJECT_PLACEHOLDER = `# Project Memory

Add notes here and the AI will see them in every conversation for this project.

Examples:
- We use PostgreSQL, not MySQL
- Deploy target is Railway
- Always write tests with Vitest
- Prefer functional React components
- The API base URL in dev is http://localhost:3000`

const GLOBAL_PLACEHOLDER = `# Global Memory

These facts apply to ALL projects and ALL conversations — they follow you everywhere.

Examples:
- My name is Alex
- I always prefer Tailwind over plain CSS
- Use TypeScript strict mode on all projects
- I deploy to Vercel
- Always write commit messages in present tense`

export default function MemoryPanel({ workspacePath, global: isGlobal = false, onClose }: Props) {
  const [content,  setContent]  = useState('')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isElectron = typeof window !== 'undefined' && !!window.api

  // Load memory on mount
  useEffect(() => {
    if (!isElectron) { setLoading(false); return }
    const loader = isGlobal
      ? window.api.readGlobalMemory()
      : (workspacePath ? window.api.readMemory(workspacePath) : Promise.resolve({ content: '' }))
    loader.then(({ content }) => {
      setContent(content)
      setLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    })
  }, [workspacePath, isGlobal])

  // Autosave 1s after last keystroke
  const persist = useCallback(async (text: string) => {
    if (!isElectron) return
    setSaving(true)
    setSaved(false)
    const result = isGlobal
      ? await window.api.saveGlobalMemory(text)
      : (workspacePath ? await window.api.saveMemory(workspacePath, text) : { ok: false, error: 'No workspace' })
    setSaving(false)
    if (result.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(result.error ?? 'Failed to save')
    }
  }, [workspacePath, isGlobal])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setContent(val)
    setError(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(val), 1000)
  }

  const handleClear = async () => {
    const label = isGlobal ? 'global memory' : 'project memory'
    if (!window.confirm(`Clear all ${label}? This cannot be undone.`)) return
    setContent('')
    await persist('')
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const lineCount = content.split('\n').length
  const charCount = content.length

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[640px] max-w-[92vw] max-h-[80vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="text-xl leading-none">{isGlobal ? '🌍' : '🧠'}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {isGlobal ? 'Global Memory' : 'Project Memory'}
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {isGlobal
                ? 'Injected into every conversation across all projects'
                : 'Injected into every conversation in this workspace'}
            </p>
          </div>
          {/* Status */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {saving && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Saving…
              </span>
            )}
            {saved && !saving && (
              <span className="text-[11px] text-green-500 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </span>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Loading…
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleChange}
              placeholder={isGlobal ? GLOBAL_PLACEHOLDER : PROJECT_PLACEHOLDER}
              spellCheck={false}
              className="flex-1 resize-none w-full px-5 py-4 text-sm font-mono
                         text-gray-800 dark:text-gray-200 bg-transparent
                         placeholder-gray-300 dark:placeholder-gray-700
                         outline-none leading-relaxed"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
          <div className="flex items-center gap-4">
            {/* Hint */}
            <p className="text-[11px] text-gray-400 dark:text-gray-600">
              Auto-saves as you type · AI adds notes via{' '}
              <code className="font-mono">{isGlobal ? 'remember_globally' : 'remember'}</code>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {error && (
              <span className="text-[11px] text-red-500">{error}</span>
            )}
            <span className="text-[11px] text-gray-300 dark:text-gray-700 font-mono">
              {lineCount} lines · {charCount} chars
            </span>
            {content.trim() && (
              <button
                onClick={handleClear}
                className="text-[11px] text-red-400 hover:text-red-600 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
