import { useState, useEffect, useRef } from 'react'

interface TourStep {
  id:       string
  title:    string
  content:  string
  icon:     string
  category: 'core' | 'modes' | 'power' | 'integration'
}

const TOUR_STEPS: TourStep[] = [
  // Core
  { id: 'workspace',  category: 'core',        icon: '📁', title: 'Workspace folder',     content: 'Set a workspace folder in Settings → the AI can read, write, and run code there. Required for most features.' },
  { id: 'apikey',     category: 'core',        icon: '🔑', title: 'API key',               content: 'Bring your own key (Anthropic / OpenAI / Gemini). Stored locally — never sent to our servers.' },
  { id: 'shortcuts',  category: 'core',        icon: '⌨️', title: 'Keyboard shortcuts',    content: 'Cmd+N new chat, Cmd+K search, Cmd+, settings, Cmd+` terminal. Press ? for the full list.' },
  { id: 'newchat',    category: 'core',        icon: '💬', title: 'Conversations',          content: 'Each chat has its own history and mode. Use tags to organise. Full-text search with Cmd+K.' },
  // Modes
  { id: 'code',       category: 'modes',       icon: '{}', title: 'Code mode',              content: 'Default mode. Chat with AI that has direct access to your workspace files via read/write tools.' },
  { id: 'agent',      category: 'modes',       icon: '>>', title: 'Agent mode',             content: 'AI plans a checklist and executes all tasks autonomously — auto-continues up to 20 turns without prompting.' },
  { id: 'voice',      category: 'modes',       icon: '🎙', title: 'Voice mode',             content: 'Speak to the AI — uses browser SpeechRecognition (works with any provider, no extra key needed).' },
  { id: 'review',     category: 'modes',       icon: '✓',  title: 'Review mode',            content: 'Quality gate before git push. AI reviews your staged diff and rates code quality 1–10.' },
  { id: 'pair',       category: 'modes',       icon: '⇄',  title: 'Pair mode',              content: 'Background watcher: AI silently monitors file changes and offers suggestions when you pause.' },
  // Power
  { id: 'memory',     category: 'power',       icon: '🧠', title: 'Project memory',         content: 'AI remembers notes in .ai-memory/notes.md. Edit via the 🧠 button. Context survives across chats.' },
  { id: 'snapshots',  category: 'power',       icon: '📸', title: 'Snapshots',              content: 'Every AI turn that edits files creates a snapshot. Restore any previous state from the session panel.' },
  { id: 'rag',        category: 'power',       icon: '🔍', title: 'Semantic search (RAG)',   content: 'Build a BM25 index in Settings → the AI auto-injects relevant code chunks for every message.' },
  { id: 'terminal',   category: 'power',       icon: '💻', title: 'Integrated terminal',    content: 'Cmd+` opens a real PTY terminal in the workspace. AI can also run commands with your approval.' },
  { id: 'compare',    category: 'power',       icon: '⚡', title: 'Multi-model compare',    content: 'Compare the same prompt across multiple providers/models side-by-side. Great for picking the best answer.' },
  // Integrations
  { id: 'github',     category: 'integration', icon: '🐙', title: 'GitHub integration',     content: 'Browse PRs and issues, create branches, auto-generate PR descriptions from your commits.' },
  { id: 'jira',       category: 'integration', icon: '📋', title: 'Jira / Linear',          content: 'Browse and create issues directly in the app. Use issue keys in your prompts to give AI context.' },
  { id: 'mcp',        category: 'integration', icon: '🔌', title: 'MCP servers',             content: 'Connect any Model Context Protocol server to expose custom tools to the AI.' },
  { id: 'presets',    category: 'integration', icon: '🎭', title: 'Agent presets',           content: 'Save provider + model + system prompt combinations and switch with one click.' },
  { id: 'backup',     category: 'integration', icon: '💾', title: 'Backup & restore',        content: 'Export all conversations or settings as JSON in Settings. Restore after reinstall or migration.' },
]

const CATEGORY_LABELS: Record<TourStep['category'], string> = {
  core: 'Core',
  modes: 'Chat modes',
  power: 'Power features',
  integration: 'Integrations'
}

const CATEGORY_ORDER: TourStep['category'][] = ['core', 'modes', 'power', 'integration']

const STORAGE_KEY = 'feature-tour-seen'

interface Props {
  onClose: () => void
}

export default function FeatureTour({ onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<TourStep['category']>('core')
  const [seenIds, setSeenIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[]) }
    catch { return new Set() }
  })
  const [search, setSearch] = useState('')
  const overlayRef = useRef<HTMLDivElement>(null)

  const markSeen = (id: string) => {
    setSeenIds(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  // Close on Escape or backdrop click
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = TOUR_STEPS.filter(s =>
    !search ||
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.content.toLowerCase().includes(search.toLowerCase())
  )

  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    steps: filtered.filter(s => s.category === cat)
  })).filter(g => g.steps.length > 0)

  const totalSeen = seenIds.size
  const progress  = Math.round((totalSeen / TOUR_STEPS.length) * 100)

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Feature Discovery</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {totalSeen} of {TOUR_STEPS.length} features explored
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Progress ring */}
            <div className="relative w-10 h-10">
              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-200 dark:text-gray-700" />
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3"
                  strokeDasharray={`${2 * Math.PI * 15}`}
                  strokeDashoffset={`${2 * Math.PI * 15 * (1 - progress / 100)}`}
                  className="text-blue-500 transition-all duration-500"
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-gray-700 dark:text-gray-300">
                {progress}%
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Close feature tour"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search features…"
              className="w-full pl-8 pr-4 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-blue-400 dark:focus:border-blue-500 text-gray-700 dark:text-gray-300 placeholder-gray-400"
            />
          </div>
        </div>

        {/* Category tabs (hidden when searching) */}
        {!search && (
          <div className="flex gap-1 px-6 py-2 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
            {CATEGORY_ORDER.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex-shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        )}

        {/* Feature list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {grouped.map(group => (
            (!search ? group.category === activeCategory : true) && (
              <div key={group.category}>
                {search && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                    {group.label}
                  </p>
                )}
                <div className="space-y-2">
                  {group.steps.map(step => {
                    const seen = seenIds.has(step.id)
                    return (
                      <button
                        key={step.id}
                        onClick={() => markSeen(step.id)}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all ${
                          seen
                            ? 'bg-gray-50 dark:bg-gray-800/50 opacity-70'
                            : 'bg-white dark:bg-gray-800 shadow-sm hover:shadow-md border border-gray-100 dark:border-gray-700'
                        }`}
                      >
                        <span className="text-xl leading-none mt-0.5 flex-shrink-0">{step.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${seen ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200'}`}>
                              {step.title}
                            </p>
                            {seen && (
                              <span className="text-green-500">
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{step.content}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          ))}

          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <svg className="w-8 h-8 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-sm">No features match "{search}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <button
            onClick={() => {
              setSeenIds(new Set())
              localStorage.removeItem(STORAGE_KEY)
            }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Reset progress
          </button>
          <button
            onClick={() => {
              TOUR_STEPS.forEach(s => markSeen(s.id))
            }}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            Mark all as seen
          </button>
        </div>
      </div>
    </div>
  )
}
