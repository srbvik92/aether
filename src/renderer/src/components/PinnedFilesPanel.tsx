/**
 * Pinned Context Files panel.
 *
 * Files pinned here are always injected into the AI system prompt for this
 * workspace, no matter what the conversation is about. Ideal for:
 *   - ARCHITECTURE.md
 *   - CONVENTIONS.md
 *   - .env.example
 *   - Any file the AI should always have in mind
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const isElectron = typeof window !== 'undefined' && !!window.api

interface Props {
  workspacePath: string
  onClose: () => void
}

export default function PinnedFilesPanel({ workspacePath, onClose }: Props) {
  const [pins,    setPins]    = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [input,   setInput]   = useState('')
  const [error,   setError]   = useState<string | null>(null)
  const [wsFiles, setWsFiles] = useState<string[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const inputRef    = useRef<HTMLInputElement>(null)
  const pickerRef   = useRef<HTMLDivElement>(null)

  // Load saved pins
  useEffect(() => {
    if (!isElectron) { setLoading(false); return }
    window.api.readPins(workspacePath).then(({ pins: p }) => {
      setPins(p)
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    })
  }, [workspacePath])

  // Load workspace files for the picker
  useEffect(() => {
    if (!isElectron || !workspacePath) return
    window.api.listWorkspaceFiles(workspacePath).then(files => setWsFiles(files))
  }, [workspacePath])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPicker) { setShowPicker(false); return }
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showPicker, onClose])

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const savePins = useCallback(async (next: string[]) => {
    if (!isElectron) return
    setSaving(true)
    await window.api.savePins(workspacePath, next)
    setSaving(false)
  }, [workspacePath])

  const addPin = useCallback(async (relPath: string) => {
    const clean = relPath.trim().replace(/\\/g, '/')
    if (!clean) return
    if (pins.includes(clean)) { setError(`"${clean}" is already pinned`); return }
    setError(null)
    const next = [...pins, clean]
    setPins(next)
    await savePins(next)
    setInput('')
    setShowPicker(false)
  }, [pins, savePins])

  const removePin = useCallback(async (relPath: string) => {
    const next = pins.filter(p => p !== relPath)
    setPins(next)
    await savePins(next)
  }, [pins, savePins])

  const filteredFiles = pickerQuery.trim()
    ? wsFiles.filter(f => f.toLowerCase().includes(pickerQuery.toLowerCase())).slice(0, 20)
    : wsFiles.filter(f => /\.(md|txt|json|yaml|yml|toml|env)$/i.test(f)).slice(0, 20)

  const baseName = (path: string) => path.split('/').pop() ?? path

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[520px] max-w-[92vw] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[70vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="text-xl leading-none">📌</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pinned Context Files</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Always injected into the AI system prompt for this workspace
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Pin list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400 text-sm">Loading…</div>
          ) : pins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-6">
              <span className="text-3xl mb-2">📌</span>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No files pinned yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-600 mt-1 max-w-xs">
                Pin ARCHITECTURE.md, CONVENTIONS.md, or any file the AI should always have in context.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {pins.map(pin => (
                <div key={pin} className="flex items-center gap-3 px-5 py-3 group hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <svg className="w-4 h-4 text-orange-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{baseName(pin)}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-600 font-mono truncate">{pin}</p>
                  </div>
                  <button
                    onClick={() => removePin(pin)}
                    className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center
                               text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all"
                    title="Unpin"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add pin input */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
          {error && (
            <p className="text-xs text-red-500 mb-2">{error}</p>
          )}
          <div className="relative" ref={pickerRef}>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
                <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value)
                    setPickerQuery(e.target.value)
                    setShowPicker(true)
                    setError(null)
                  }}
                  onFocus={() => setShowPicker(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addPin(input) }
                    if (e.key === 'Escape') { setShowPicker(false) }
                  }}
                  placeholder="Type a relative path or pick from workspace…"
                  className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none"
                />
              </div>
              <button
                onClick={() => addPin(input)}
                disabled={!input.trim() || saving}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex-shrink-0"
              >
                Pin
              </button>
            </div>

            {/* File picker dropdown */}
            {showPicker && filteredFiles.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 right-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-10 overflow-hidden max-h-48 overflow-y-auto">
                {filteredFiles.map(f => (
                  <button
                    key={f}
                    onClick={() => addPin(f)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{baseName(f)}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-600 ml-1.5 font-mono truncate">{f}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-2">
            {saving ? 'Saving…' : `${pins.length} file${pins.length !== 1 ? 's' : ''} pinned · Files are injected as \`## Pinned Context Files\` in the system prompt`}
          </p>
        </div>
      </div>
    </div>
  )
}
