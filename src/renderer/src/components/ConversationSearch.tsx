import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Conversation } from '../../../shared/types'

interface Props {
  conversations: Conversation[]
  onSelect:      (convId: string, msgId: string) => void
  onClose:       () => void
}

interface SearchResult {
  convId:     string
  convTitle:  string
  msgId:      string
  role:       'user' | 'assistant'
  excerpt:    string
  before:     string   // text before match
  match:      string   // the matched portion (preserves original casing)
  after:      string   // text after match
  updatedAt:  number
}

// ── Extract a ~120-char excerpt centred on the first match ────────────────────
function makeExcerpt(
  content: string,
  query: string,
  maxLen = 140
): { before: string; match: string; after: string } | null {
  const lower = content.toLowerCase()
  const qLow  = query.toLowerCase()
  const idx   = lower.indexOf(qLow)
  if (idx < 0) return null

  const half  = Math.floor((maxLen - query.length) / 2)
  const start = Math.max(0, idx - half)
  const end   = Math.min(content.length, idx + query.length + half)

  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''

  return {
    before: prefix + content.slice(start, idx),
    match:  content.slice(idx, idx + query.length),
    after:  content.slice(idx + query.length, end) + suffix
  }
}

// ── Run the search across all conversations ───────────────────────────────────
function search(conversations: Conversation[], query: string): SearchResult[] {
  if (!query.trim()) return []
  const q = query.trim()

  const results: SearchResult[] = []

  for (const conv of conversations) {
    for (const msg of conv.messages) {
      if (msg.role === 'system') continue
      const ex = makeExcerpt(msg.content, q)
      if (!ex) continue
      results.push({
        convId:    conv.id,
        convTitle: conv.title,
        msgId:     msg.id,
        role:      msg.role as 'user' | 'assistant',
        excerpt:   msg.content,
        before:    ex.before,
        match:     ex.match,
        after:     ex.after,
        updatedAt: conv.updatedAt
      })
    }
  }

  // Sort by most recently updated conversation first, then deduplicate per conv
  // (show max 3 matches per conversation to avoid overwhelming one conversation)
  const countPerConv = new Map<string, number>()
  return results
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(r => {
      const count = countPerConv.get(r.convId) ?? 0
      if (count >= 3) return false
      countPerConv.set(r.convId, count + 1)
      return true
    })
    .slice(0, 60)
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ConversationSearch({ conversations, onSelect, onClose }: Props) {
  const [query,     setQuery]     = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef    = useRef<HTMLInputElement>(null)
  const listRef     = useRef<HTMLDivElement>(null)
  const activeRef   = useRef<HTMLButtonElement>(null)

  const results = useMemo(() => search(conversations, query), [conversations, query])

  // Auto-focus on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // Reset active index when results change
  useEffect(() => setActiveIdx(0), [results.length])

  // Scroll active item into view
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [activeIdx])

  const commit = useCallback((idx: number) => {
    const r = results[idx]
    if (r) { onSelect(r.convId, r.msgId); onClose() }
  }, [results, onSelect, onClose])

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault(); commit(activeIdx)
    } else if (e.key === 'Escape') {
      e.preventDefault(); onClose()
    }
  }

  // Close on overlay click
  const onOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onOverlayClick}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[70vh]">

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search all conversations…"
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto flex-1">
          {!query.trim() ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-600">
              <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-sm">Type to search across all messages</p>
              <p className="text-xs mt-1">{conversations.length} conversation{conversations.length !== 1 ? 's' : ''} · ↑↓ navigate · Enter open</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-600">
              <p className="text-sm">No results for <span className="font-mono text-gray-500 dark:text-gray-400">"{query}"</span></p>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-gray-50 dark:border-gray-800">
                <p className="text-[10px] text-gray-400 dark:text-gray-600 uppercase tracking-wider font-semibold">
                  {results.length} result{results.length !== 1 ? 's' : ''}
                </p>
              </div>

              {results.map((r, idx) => {
                const isActive = idx === activeIdx
                return (
                  <button
                    key={`${r.convId}-${r.msgId}`}
                    ref={isActive ? activeRef : null}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => commit(idx)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    {/* Role badge */}
                    <div className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                      r.role === 'user'
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}>
                      {r.role === 'user' ? 'U' : 'AI'}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Conversation title */}
                      <p className={`text-xs font-semibold truncate mb-0.5 ${
                        isActive
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {r.convTitle}
                      </p>
                      {/* Excerpt with highlighted match */}
                      <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed">
                        <span className="text-gray-400 dark:text-gray-500">{r.before}</span>
                        <mark className="bg-yellow-200 dark:bg-yellow-900/60 text-yellow-900 dark:text-yellow-200 rounded px-0.5 not-italic font-medium">
                          {r.match}
                        </mark>
                        <span className="text-gray-400 dark:text-gray-500">{r.after}</span>
                      </p>
                    </div>

                    {/* Arrow indicator */}
                    {isActive && (
                      <svg className="w-4 h-4 text-blue-400 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4">
          {[['↑↓', 'Navigate'], ['↵', 'Open'], ['Esc', 'Close']].map(([key, label]) => (
            <span key={key} className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-600">
              <kbd className="font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-[9px]">{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
