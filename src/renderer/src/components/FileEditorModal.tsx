/**
 * Inline file editor — opens any workspace file for direct editing.
 * Accessible by clicking file paths in the Changed Files bar.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const isElectron = typeof window !== 'undefined' && !!window.api

interface Props {
  workspacePath: string
  relativePath:  string
  onClose:       () => void
}

export default function FileEditorModal({ workspacePath, relativePath, onClose }: Props) {
  const [content,  setContent]  = useState('')
  const [original, setOriginal] = useState('')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [saved,    setSaved]    = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load file
  useEffect(() => {
    if (!isElectron) { setLoading(false); return }
    setLoading(true)
    setError(null)
    window.api.readWorkspaceFile(workspacePath, relativePath).then(({ content: c, error: e }) => {
      if (e) { setError(e); setLoading(false); return }
      setContent(c)
      setOriginal(c)
      setLoading(false)
      setTimeout(() => textareaRef.current?.focus(), 50)
    })
  }, [workspacePath, relativePath])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        onClose()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [content]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    if (!isElectron || saving) return
    setSaving(true)
    setError(null)
    const result = await window.api.writeWorkspaceFile(workspacePath, relativePath, content)
    setSaving(false)
    if (result.ok) {
      setOriginal(content)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(result.error ?? 'Save failed')
    }
  }, [workspacePath, relativePath, content, saving])

  const isDirty    = content !== original
  const lineCount  = content.split('\n').length
  const ext        = relativePath.split('.').pop()?.toLowerCase() ?? ''
  const language   = (EXT_LABEL[ext] ?? ext.toUpperCase()) || 'TEXT'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[780px] max-w-[96vw] h-[82vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/80">
          <span className="text-base leading-none">✏️</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{relativePath.split('/').pop()}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{relativePath}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Dirty indicator */}
            {isDirty && !saving && (
              <span className="text-xs text-yellow-500 dark:text-yellow-400">● unsaved</span>
            )}
            {saved && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving || loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                         bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
                         text-white"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Close (Esc)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-hidden relative">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-red-500 gap-2">
              <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-sm">{error}</p>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="w-full h-full resize-none outline-none p-4 font-mono text-sm
                         text-gray-800 dark:text-gray-200
                         bg-white dark:bg-gray-900
                         leading-relaxed"
              style={{ tabSize: 2 }}
            />
          )}
        </div>

        {/* Footer status bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-[11px] text-gray-400 dark:text-gray-600 flex-shrink-0">
          <span>{language} · {lineCount} line{lineCount !== 1 ? 's' : ''}</span>
          <span>Ctrl+S to save · Esc to close</span>
        </div>
      </div>
    </div>
  )
}

const EXT_LABEL: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
  py: 'Python', rb: 'Ruby', rs: 'Rust', go: 'Go',
  java: 'Java', kt: 'Kotlin', swift: 'Swift', cs: 'C#',
  cpp: 'C++', c: 'C', h: 'C Header', hpp: 'C++ Header',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  xml: 'XML', html: 'HTML', css: 'CSS', scss: 'SCSS',
  sql: 'SQL', sh: 'Shell', bash: 'Bash', md: 'Markdown',
  txt: 'Text', env: 'Env',
}
