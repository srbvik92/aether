import { useState, useEffect, useRef, useMemo } from 'react'

interface Props {
  query:    string
  files:    string[]
  onSelect: (filePath: string) => void
  onClose:  () => void
}

// ── Simple scoring: exact basename match > name starts-with > path contains ──
function scoreFile(filePath: string, query: string): number {
  const q    = query.toLowerCase()
  const name = filePath.split('/').pop()!.toLowerCase()
  const path = filePath.toLowerCase()
  if (name === q)              return 100
  if (name.startsWith(q))     return 80
  if (name.includes(q))       return 60
  if (path.startsWith(q))     return 40
  if (path.includes(q))       return 20
  return 0
}

export default function FileMentionDropdown({ query, files, onSelect, onClose }: Props) {
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef                   = useRef<HTMLDivElement>(null)
  const activeItemRef             = useRef<HTMLButtonElement>(null)

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!query) return files.slice(0, 30)
    const q = query.toLowerCase()
    return files
      .map(f => ({ f, score: scoreFile(f, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.f.length - b.f.length)
      .slice(0, 30)
      .map(x => x.f)
  }, [query, files])

  // Reset active index when filtered list changes
  useEffect(() => setActiveIdx(0), [filtered.length])

  // Scroll active item into view
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  // ── Keyboard handling (capture phase so we intercept before textarea) ─────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActiveIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (filtered[activeIdx]) onSelect(filtered[activeIdx])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    // Capture phase ensures we run before the textarea's React onKeyDown handler
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [filtered, activeIdx, onSelect, onClose])

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 px-4 py-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          No files match <span className="font-mono text-gray-600 dark:text-gray-400">@{query}</span>
        </p>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Mention a file
        </span>
        <span className="text-[10px] text-gray-300 dark:text-gray-600">
          ↑↓ navigate · Enter select · Esc cancel
        </span>
      </div>

      {/* File list */}
      <div className="max-h-52 overflow-y-auto">
        {filtered.map((filePath, idx) => {
          const parts    = filePath.split('/')
          const basename = parts.pop()!
          const dir      = parts.join('/')
          const isActive = idx === activeIdx
          const ext      = basename.split('.').pop() ?? ''

          return (
            <button
              key={filePath}
              ref={isActive ? activeItemRef : null}
              onMouseDown={(e) => { e.preventDefault(); onSelect(filePath) }}
              onMouseEnter={() => setActiveIdx(idx)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                isActive
                  ? 'bg-purple-50 dark:bg-purple-900/30'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              {/* File icon */}
              <div className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold uppercase ${
                isActive
                  ? 'bg-purple-100 dark:bg-purple-800/50 text-purple-600 dark:text-purple-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}>
                {ext.slice(0, 3)}
              </div>

              {/* Name + path */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${
                  isActive
                    ? 'text-purple-700 dark:text-purple-300'
                    : 'text-gray-800 dark:text-gray-200'
                }`}>
                  {basename}
                </p>
                {dir && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{dir}/</p>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
