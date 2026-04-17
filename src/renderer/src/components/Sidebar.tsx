import React, { useState, useRef, useEffect, KeyboardEvent, useMemo } from 'react'
import { AppSettings, Conversation } from '../../../shared/types'
import GitStatusBar from './GitStatusBar'
import { useFocusTrap } from '../hooks/useFocusTrap'

const isElectron = typeof window !== 'undefined' && !!window.api

const TAG_COLORS = [
  'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700',
  'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700',
  'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700',
  'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700',
  'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-700',
  'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700',
]

function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) & 0x7fffffff
  return TAG_COLORS[hash % TAG_COLORS.length]
}

interface Props {
  conversations:       Conversation[]
  activeConvId:        string | null
  settings:            AppSettings
  onNew:               () => void
  onSelect:            (id: string) => void
  onDelete:            (id: string) => void
  onRename:            (id: string, title: string) => void
  onOpenSettings:      () => void
  onOpenCosts:         () => void
  onOpenGlobalMemory:  () => void
  onSwitchWorkspace:   (path: string) => void
  onToggleTheme:       () => void
  onSetTheme?:         (theme: 'dark' | 'light' | 'system') => void
  onToggleTerminal:    () => void
  terminalOpen:        boolean
  onOpenSearch?:       () => void
  onOpenCompare?:      () => void
  onOpenGitHub?:       () => void
  onOpenScheduler?:    () => void
  onOpenPresets?:      () => void
  onOpenMcp?:          () => void
  onOpenJiraLinear?:   () => void
  onImport?:           () => void
  onExportAll?:        () => void
  onImportAll?:        () => void
  onOpenFeatureTour?:  () => void
  onOpenLogs?:         () => void
  onTagChange?:        (convId: string, tags: string[]) => void
}

interface TagPickerProps {
  convTags: string[]
  allTags:  string[]
  onAdd:    (tag: string) => void
  onRemove: (tag: string) => void
  onClose:  () => void
}

function TagPicker({ convTags, allTags, onAdd, onRemove, onClose }: TagPickerProps) {
  const [value, setValue] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  const handleAdd = () => {
    const t = value.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !convTags.includes(t)) { onAdd(t); setValue('') }
  }

  const suggestions = allTags.filter(t => !convTags.includes(t))

  return (
    <div ref={containerRef} className="mx-2 mb-1 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      {convTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {convTags.map(tag => (
            <button key={tag} onClick={() => onRemove(tag)}
                    className={`flex items-center gap-0.5 px-1.5 py-0 rounded-full border text-[9px] font-medium ${tagColor(tag)} opacity-90 hover:opacity-70 transition-opacity`}
                    title="Click to remove">
              {tag} <span className="ml-0.5 text-[8px]">✕</span>
            </button>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {suggestions.map(tag => (
            <button key={tag} onClick={() => onAdd(tag)}
                    className={`px-1.5 py-0 rounded-full border text-[9px] font-medium ${tagColor(tag)} opacity-50 hover:opacity-100 transition-opacity`}>
              + {tag}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input autoFocus value={value}
               onChange={e => setValue(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } if (e.key === 'Escape') onClose() }}
               placeholder="New tag…"
               className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-[11px] outline-none focus:border-blue-400" />
        <button onClick={handleAdd} disabled={!value.trim()}
                className="px-2 py-1 rounded bg-blue-600 text-white text-[10px] disabled:opacity-40 hover:bg-blue-500 transition-colors">
          Add
        </button>
      </div>
    </div>
  )
}

// ── Theme cycle button (dark → light → system) ───────────────────────────────
function ThemeCycleButton({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  const THEMES = ['dark', 'light', 'system'] as const
  type ThemeVal = typeof THEMES[number]
  const current = (THEMES.includes(theme as ThemeVal) ? theme : 'dark') as ThemeVal
  const next: Record<ThemeVal, ThemeVal> = { dark: 'light', light: 'system', system: 'dark' }
  const labels: Record<ThemeVal, string> = { dark: '🌙', light: '☀️', system: '💻' }
  const names:  Record<ThemeVal, string> = { dark: 'Dark', light: 'Light', system: 'System' }

  return (
    <button
      onClick={onToggle}
      className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 bg-white dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
      title={`Theme: ${names[current]} — click to switch to ${names[next[current]]}`}
      aria-label={`Switch theme — currently ${names[current]}`}
    >
      <span className="text-sm leading-none">{labels[current]}</span>
      <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{names[current]}</span>
    </button>
  )
}

export default function Sidebar({
  conversations, activeConvId, settings,
  onNew, onSelect, onDelete, onRename, onOpenSettings, onOpenCosts, onOpenGlobalMemory,
  onSwitchWorkspace, onToggleTheme, onToggleTerminal, terminalOpen, onOpenSearch,
  onOpenCompare, onOpenGitHub, onOpenScheduler, onOpenPresets, onOpenMcp,
  onOpenJiraLinear, onImport, onExportAll, onImportAll, onOpenFeatureTour, onOpenLogs, onTagChange,
  onSetTheme
}: Props) {
  const [search,          setSearch]          = useState('')
  const [renamingId,      setRenamingId]      = useState<string | null>(null)
  const [renameValue,     setRenameValue]     = useState('')
  const [recentsOpen,     setRecentsOpen]     = useState(false)
  const [activeTag,       setActiveTag]       = useState<string | null>(null)
  const [tagPickerConvId, setTagPickerConvId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const recentsRef     = useRef<HTMLDivElement>(null)

  // Close recents popover on outside click
  useEffect(() => {
    if (!recentsOpen) return
    const handler = (e: MouseEvent) => {
      if (recentsRef.current && !recentsRef.current.contains(e.target as Node)) {
        setRecentsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [recentsOpen])

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    conversations.forEach(c => c.tags?.forEach(t => set.add(t)))
    return [...set].sort()
  }, [conversations])

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.id)
    setRenameValue(conv.title)
  }

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { setRenamingId(null) }
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const filtered = conversations.filter(c => {
    const matchSearch = !search.trim() || c.title.toLowerCase().includes(search.toLowerCase())
    const matchTag    = !activeTag || (c.tags ?? []).includes(activeTag)
    return matchSearch && matchTag
  })

  return (
    <div className="w-64 flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">

      {/* Titlebar drag region */}
      <div className="h-9" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Search bar + New chat — single row */}
      <div className="px-3 pb-2 flex items-center gap-1.5">
        {/* Filter input */}
        <div className="flex-1 flex items-center gap-2 px-2 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="flex-1 bg-transparent text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {/* New chat */}
        <button
          onClick={onNew}
          title="New chat (Ctrl+N)"
          aria-label="New chat (Ctrl+N)"
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap min-h-0">
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setActiveTag(prev => prev === tag ? null : tag)}
              className={`px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all ${tagColor(tag)} ${
                activeTag === tag ? 'opacity-100 ring-1 ring-offset-1 ring-current' : 'opacity-60 hover:opacity-100'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5" role="list">
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 dark:text-gray-600 text-xs py-8">
            {search ? 'No matches found' : 'No conversations yet'}
          </p>
        )}

        {filtered.map((conv) => (
          <React.Fragment key={conv.id}>
          <div
            role="listitem"
            aria-current={activeConvId === conv.id ? 'true' : undefined}
            onClick={() => { if (renamingId !== conv.id) onSelect(conv.id) }}
            className={`group flex items-start gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
              conv.id === activeConvId
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400'
            }`}
          >
            <div className="flex-1 min-w-0">
              {renamingId === conv.id ? (
                // ── Inline rename input ──────────────────────────────────────
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={onRenameKey}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-white rounded px-1 py-0.5 outline-none ring-1 ring-blue-500"
                />
              ) : (
                // ── Title (double-click to rename) ───────────────────────────
                <p
                  className="text-sm truncate"
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(conv) }}
                  title="Double-click to rename"
                >
                  {conv.title}
                </p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1.5">
                <span>{formatDate(conv.updatedAt)}</span>
                {conv.model && (
                  <span className="text-[10px] font-mono text-gray-300 dark:text-gray-600 truncate max-w-[80px]" title={`${conv.provider} · ${conv.model}`}>
                    {conv.model.split('-').slice(0, 2).join('-')}
                  </span>
                )}
              </p>
              {/* Tags */}
              {(conv.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {(conv.tags ?? []).map(tag => (
                    <span key={tag} className={`px-1.5 py-0 rounded-full border text-[9px] font-medium ${tagColor(tag)}`}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons — visible on hover */}
            {renamingId !== conv.id && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                {/* Rename */}
                <button
                  onClick={(e) => { e.stopPropagation(); startRename(conv) }}
                  className="text-gray-400 hover:text-blue-500 transition-colors p-0.5"
                  title="Rename"
                  aria-label="Rename"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                {/* Tag button */}
                {onTagChange && (
                  <button
                    onClick={e => { e.stopPropagation(); setTagPickerConvId(prev => prev === conv.id ? null : conv.id) }}
                    className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                    title="Manage tags"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2h2z" />
                    </svg>
                  </button>
                )}
                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
                  className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
                  title="Delete"
                  aria-label="Delete"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {tagPickerConvId === conv.id && onTagChange && (
            <TagPicker
              convTags={conv.tags ?? []}
              allTags={allTags}
              onAdd={tag => {
                onTagChange(conv.id, [...(conv.tags ?? []).filter(t => t !== tag), tag])
                setTagPickerConvId(null)
              }}
              onRemove={tag => onTagChange(conv.id, (conv.tags ?? []).filter(t => t !== tag))}
              onClose={() => setTagPickerConvId(null)}
            />
          )}
          </React.Fragment>
        ))}
      </div>

      {/* Git status bar */}
      <GitStatusBar workspacePath={settings.workspacePath ?? ''} />

      {/* Footer */}
      <div className="border-t border-gray-200 dark:border-gray-800 px-3 pt-2 pb-3 space-y-2">

        {/* Row 1 — Theme cycle (prominent) + Settings button */}
        <div className="flex items-center gap-1.5">
          {/* Theme — full-width 3-state pill */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex-shrink-0">
            {(['dark', 'light', 'system'] as const).map(t => (
              <button
                key={t}
                onClick={() => {
                  if (settings.theme !== t) {
                    if (onSetTheme) onSetTheme(t)
                    else onToggleTheme()
                  }
                }}
                title={t === 'dark' ? 'Dark mode' : t === 'light' ? 'Light mode' : 'System (follow OS)'}
                aria-label={t === 'dark' ? 'Dark mode' : t === 'light' ? 'Light mode' : 'System (follow OS)'}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors ${
                  settings.theme === t
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span>{t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '💻'}</span>
                <span className="hidden sm:inline">{t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'System'}</span>
              </button>
            ))}
          </div>

          {/* Settings icon button */}
          <button
            onClick={onOpenSettings}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="Settings (Ctrl+,)"
            aria-label="Settings (Ctrl+,)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* Row 2 — All tool icon buttons, wrapping grid */}
        <div className="flex flex-wrap gap-0.5">

          {/* Cost dashboard */}
          <button onClick={onOpenCosts} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-yellow-500 dark:hover:text-yellow-400" title="Usage & Cost" aria-label="Usage & Cost">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>

          {/* Global memory */}
          <button onClick={onOpenGlobalMemory} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-green-500 dark:hover:text-green-400" title="Global Memory" aria-label="Global Memory">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>

          {/* Terminal */}
          <button onClick={onToggleTerminal} className={`w-7 h-7 rounded-lg transition-colors flex items-center justify-center ${terminalOpen ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`} title="Toggle terminal (Ctrl+`)" aria-label="Toggle terminal">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3" /></svg>
          </button>

          {/* Compare models */}
          {onOpenCompare && (
            <button onClick={onOpenCompare} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-purple-500 dark:hover:text-purple-400" title="Compare Models" aria-label="Compare Models">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
            </button>
          )}

          {/* GitHub */}
          {onOpenGitHub && (
            <button onClick={onOpenGitHub} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-gray-100" title="GitHub" aria-label="GitHub">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </button>
          )}

          {/* Scheduler */}
          {onOpenScheduler && (
            <button onClick={onOpenScheduler} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-orange-500 dark:hover:text-orange-400" title="Scheduled Tasks" aria-label="Scheduled Tasks">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
          )}

          {/* Agent Presets */}
          {onOpenPresets && (
            <button onClick={onOpenPresets} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400" title="Agent Presets" aria-label="Agent Presets">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </button>
          )}

          {/* MCP Servers */}
          {onOpenMcp && (
            <button onClick={onOpenMcp} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-purple-500 dark:hover:text-purple-400" title="MCP Servers" aria-label="MCP Servers">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </button>
          )}

          {/* Jira / Linear */}
          {onOpenJiraLinear && (
            <button onClick={onOpenJiraLinear} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" title="Jira / Linear issues" aria-label="Jira / Linear issues">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            </button>
          )}

          {/* Import conversation */}
          {onImport && (
            <button onClick={onImport} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-teal-500 dark:hover:text-teal-400" title="Import conversation (.md)" aria-label="Import conversation">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
            </button>
          )}

          {/* Export all conversations */}
          {onExportAll && (
            <button onClick={onExportAll} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-green-500 dark:hover:text-green-400" title="Backup all conversations" aria-label="Backup all conversations">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            </button>
          )}

          {/* Import all conversations */}
          {onImportAll && (
            <button onClick={onImportAll} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-green-500 dark:hover:text-green-400" title="Restore conversations from backup" aria-label="Restore conversations from backup">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
            </button>
          )}

          {/* Feature tour */}
          {onOpenFeatureTour && (
            <button onClick={onOpenFeatureTour} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-blue-500 dark:hover:text-blue-400" title="Feature discovery" aria-label="Feature discovery">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            </button>
          )}

          {/* Logs */}
          {onOpenLogs && (
            <button onClick={onOpenLogs} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="View application logs" aria-label="View logs">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </button>
          )}

          {/* Recent workspaces */}
          {(settings.recentWorkspaces?.length ?? 0) > 0 && (
            <div className="relative" ref={recentsRef}>
              <button
                onClick={() => setRecentsOpen(o => !o)}
                className={`w-7 h-7 rounded-lg transition-colors flex items-center justify-center ${recentsOpen ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-500' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                title="Recent workspaces" aria-label="Recent workspaces"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </button>
              {recentsOpen && (
                <div className="absolute bottom-full mb-2 left-0 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Recent Workspaces</p>
                  </div>
                  <div className="py-1 max-h-64 overflow-y-auto">
                    {(settings.recentWorkspaces ?? []).map(p => {
                      const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
                      const name  = parts[parts.length - 1] ?? p
                      const parent = parts[parts.length - 2] ? `…/${parts[parts.length - 2]}` : ''
                      const isCurrent = p === settings.workspacePath
                      return (
                        <button key={p} onClick={() => { onSwitchWorkspace(p); setRecentsOpen(false) }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${isCurrent ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          title={p}
                        >
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium truncate ${isCurrent ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>{name}</p>
                            {parent && <p className="text-[10px] text-gray-400 dark:text-gray-600 truncate">{parent}</p>}
                          </div>
                          {isCurrent && <svg className="w-3 h-3 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Keyboard shortcut hints */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {[['Ctrl+N','New'], ['Ctrl+,','Settings'], ['Ctrl+/','Focus'], ['Ctrl+`','Terminal'], ['Ctrl+⇧F','Search']].map(([k, label]) => (
            <span key={k} className="text-[10px] text-gray-300 dark:text-gray-700">
              <kbd className="font-mono">{k}</kbd> {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
