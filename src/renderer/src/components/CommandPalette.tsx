/**
 * CommandPalette — Cmd+K / Ctrl+K universal action launcher.
 * Searchable list of app-wide actions, sorted by relevance.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Command definitions ────────────────────────────────────────────────────

export type CommandCategory =
  | 'chat'
  | 'navigation'
  | 'workspace'
  | 'git'
  | 'view'
  | 'settings'

export interface PaletteCommand {
  id:          string
  label:       string
  description?: string
  icon:        string
  category:    CommandCategory
  shortcut?:   string
  keywords?:   string[]  // extra search terms
  action:      () => void
  disabled?:   boolean
}

interface Props {
  open:     boolean
  onClose:  () => void
  commands: PaletteCommand[]
}

// ── Category labels & order ────────────────────────────────────────────────

const CATEGORY_ORDER: CommandCategory[] = ['chat', 'navigation', 'workspace', 'git', 'view', 'settings']
const CATEGORY_LABELS: Record<CommandCategory, string> = {
  chat:       'Chat',
  navigation: 'Navigation',
  workspace:  'Workspace',
  git:        'Git',
  view:       'View',
  settings:   'Settings',
}

// ── Score a command against a query ───────────────────────────────────────

function score(cmd: PaletteCommand, q: string): number {
  if (!q) return 0
  const lq = q.toLowerCase()
  const label = cmd.label.toLowerCase()
  const desc  = (cmd.description ?? '').toLowerCase()
  const kws   = (cmd.keywords ?? []).join(' ').toLowerCase()

  if (label === lq)               return 100
  if (label.startsWith(lq))       return 80
  if (label.includes(lq))         return 60
  if (desc.includes(lq))          return 40
  if (kws.includes(lq))           return 30
  return 0
}

export default function CommandPalette({ open, onClose, commands }: Props) {
  const [query,     setQuery]     = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef  = useRef<HTMLInputElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Close on Escape (global)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, onClose])

  // ── Filter + sort ──────────────────────────────────────────────────────
  const filtered: PaletteCommand[] = query.trim()
    ? commands
        .filter(c => !c.disabled && score(c, query) > 0)
        .sort((a, b) => score(b, query) - score(a, query))
    : commands.filter(c => !c.disabled)

  // Group by category when no query
  const grouped = !query.trim()
    ? CATEGORY_ORDER
        .map(cat => ({
          cat,
          items: filtered.filter(c => c.category === cat),
        }))
        .filter(g => g.items.length > 0)
    : null

  // Flat list (for arrow navigation)
  const flat = grouped ? grouped.flatMap(g => g.items) : filtered

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const confirmActive = useCallback(() => {
    const cmd = flat[activeIdx]
    if (cmd) { cmd.action(); onClose() }
  }, [flat, activeIdx, onClose])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flat.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); confirmActive() }
  }

  // Reset activeIdx when query or list changes
  useEffect(() => { setActiveIdx(0) }, [query])

  if (!open) return null

  const renderItem = (cmd: PaletteCommand, idx: number) => (
    <button
      key={cmd.id}
      data-idx={idx}
      onMouseDown={e => { e.preventDefault(); cmd.action(); onClose() }}
      onMouseEnter={() => setActiveIdx(idx)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        idx === activeIdx
          ? 'bg-blue-50 dark:bg-blue-900/30'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <span className="text-lg flex-shrink-0 w-6 text-center leading-none">{cmd.icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
          {cmd.label}
        </span>
        {cmd.description && (
          <span className="block text-xs text-gray-400 dark:text-gray-500 truncate">{cmd.description}</span>
        )}
      </span>
      {cmd.shortcut && (
        <kbd className="flex-shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">
          {cmd.shortcut}
        </kbd>
      )}
    </button>
  )

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden
                   border border-gray-200 dark:border-gray-700 flex flex-col"
        style={{ maxHeight: '70vh' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <svg className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none"
          />
          {query && (
            <button
              onMouseDown={e => { e.preventDefault(); setQuery('') }}
              className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}
          <kbd className="flex-shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto flex-1">
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No commands found for <strong>"{query}"</strong>
            </div>
          ) : grouped ? (
            // Grouped view (no query)
            grouped.map(({ cat, items }) => (
              <div key={cat}>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50">
                  {CATEGORY_LABELS[cat]}
                </div>
                {items.map(cmd => renderItem(cmd, flat.indexOf(cmd)))}
              </div>
            ))
          ) : (
            // Flat search results
            flat.map((cmd, idx) => renderItem(cmd, idx))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
          <span>↑↓ navigate</span>
          <span>·</span>
          <span>↵ select</span>
          <span>·</span>
          <span>Esc close</span>
          <span className="ml-auto">{flat.length} action{flat.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}
