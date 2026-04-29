import { useRef, useState, useCallback, useEffect } from 'react'

// ── Connector presets ────────────────────────────────────────────────────────

interface Connector {
  id:       string
  name:     string
  icon:     string   // emoji or short text
  url:      string
  color:    string   // tailwind accent for the sidebar chip
}

const CONNECTORS: Connector[] = [
  { id: 'supabase',    name: 'Supabase',    icon: '⚡', url: 'https://supabase.com/dashboard',           color: 'text-emerald-400' },
  { id: 'vercel',      name: 'Vercel',      icon: '▲', url: 'https://vercel.com/dashboard',             color: 'text-white' },
  { id: 'github',      name: 'GitHub',      icon: '🐙', url: 'https://github.com',                       color: 'text-gray-300' },
  { id: 'cloudflare',  name: 'Cloudflare',  icon: '🌥', url: 'https://dash.cloudflare.com',              color: 'text-orange-400' },
  { id: 'netlify',     name: 'Netlify',     icon: '📦', url: 'https://app.netlify.com',                  color: 'text-teal-400' },
  { id: 'railway',     name: 'Railway',     icon: '🚂', url: 'https://railway.app/dashboard',            color: 'text-purple-400' },
  { id: 'stripe',      name: 'Stripe',      icon: '💳', url: 'https://dashboard.stripe.com',             color: 'text-indigo-400' },
  { id: 'sentry',      name: 'Sentry',      icon: '🔭', url: 'https://sentry.io',                        color: 'text-pink-400' },
  { id: 'planetscale', name: 'PlanetScale', icon: '🪐', url: 'https://app.planetscale.com',              color: 'text-yellow-400' },
  { id: 'neon',        name: 'Neon',        icon: '🌲', url: 'https://console.neon.tech',                color: 'text-green-400' },
  { id: 'fly',         name: 'Fly.io',      icon: '✈️', url: 'https://fly.io/dashboard',                 color: 'text-sky-400' },
  { id: 'render',      name: 'Render',      icon: '🎨', url: 'https://dashboard.render.com',             color: 'text-blue-400' },
]

// ── Webview type augmentation ────────────────────────────────────────────────
// Electron's <webview> is a custom element not in standard React/TS types.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: string
          useragent?: string
          webpreferences?: string
          style?: React.CSSProperties
          className?: string
          ref?: React.Ref<HTMLElement & WebviewElement>
        },
        HTMLElement
      >
    }
  }
}

interface WebviewElement extends HTMLElement {
  loadURL: (url: string) => void
  goBack: () => void
  goForward: () => void
  reload: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getTitle: () => string
  addEventListener(event: 'did-navigate', handler: (e: { url: string }) => void): void
  addEventListener(event: 'did-navigate-in-page', handler: (e: { url: string }) => void): void
  addEventListener(event: 'did-start-loading', handler: () => void): void
  addEventListener(event: 'did-stop-loading', handler: () => void): void
  addEventListener(event: 'page-title-updated', handler: (e: { title: string }) => void): void
  removeEventListener(event: string, handler: (...args: unknown[]) => void): void
}

// ── Tab state ────────────────────────────────────────────────────────────────

interface Tab {
  id:        string
  connectorId: string | null   // null = custom URL
  url:       string
  title:     string
  loading:   boolean
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EmbeddedBrowserPanel({ onClose }: Props) {
  const [tabs,       setTabs]       = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [addressBar, setAddressBar] = useState('')
  const [canBack,    setCanBack]    = useState(false)
  const [canFwd,     setCanFwd]     = useState(false)

  const webviewRef = useRef<(HTMLElement & WebviewElement) | null>(null)

  // ── Open a connector ──────────────────────────────────────────────────────
  const openConnector = useCallback((connector: Connector) => {
    // Reuse existing tab for this connector if one is already open
    const existing = tabs.find(t => t.connectorId === connector.id)
    if (existing) { setActiveTabId(existing.id); return }

    const tab: Tab = {
      id: genId(),
      connectorId: connector.id,
      url: connector.url,
      title: connector.name,
      loading: true,
    }
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setAddressBar(connector.url)
  }, [tabs])

  // Open first connector on mount
  useEffect(() => {
    if (tabs.length === 0) {
      const supabase = CONNECTORS[0]
      const tab: Tab = {
        id: genId(),
        connectorId: supabase.id,
        url: supabase.url,
        title: supabase.name,
        loading: true,
      }
      setTabs([tab])
      setActiveTabId(tab.id)
      setAddressBar(supabase.url)
    }
  }, [])

  const activeTab = tabs.find(t => t.id === activeTabId) ?? null

  // ── Navigation helpers ────────────────────────────────────────────────────
  const navigate = useCallback((url: string) => {
    let target = url.trim()
    if (!target) return
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target
    if (!activeTabId) return
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: target, loading: true } : t))
    setAddressBar(target)
    webviewRef.current?.loadURL(target)
  }, [activeTabId])

  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigate(addressBar)
  }

  // ── Close tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1]?.id ?? null)
        setAddressBar(next[next.length - 1]?.url ?? '')
      }
      return next
    })
  }, [activeTabId])

  // ── Webview event wiring ─────────────────────────────────────────────────
  // We use a data-tab-id attribute approach — a single <webview> per active tab.
  // On tab switch we update `src`; Electron loads the new URL.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !activeTabId) return

    const onNavigate = (e: { url: string }) => {
      setAddressBar(e.url)
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: e.url } : t))
      setCanBack(wv.canGoBack())
      setCanFwd(wv.canGoForward())
    }
    const onStartLoading = () => {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, loading: true } : t))
    }
    const onStopLoading = () => {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, loading: false } : t))
      setCanBack(wv.canGoBack())
      setCanFwd(wv.canGoForward())
    }
    const onTitleUpdate = (e: { title: string }) => {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, title: e.title || t.title } : t))
    }

    wv.addEventListener('did-navigate',         onNavigate as EventListener)
    wv.addEventListener('did-navigate-in-page',  onNavigate as EventListener)
    wv.addEventListener('did-start-loading',     onStartLoading as EventListener)
    wv.addEventListener('did-stop-loading',      onStopLoading as EventListener)
    wv.addEventListener('page-title-updated',    onTitleUpdate as EventListener)

    return () => {
      wv.removeEventListener('did-navigate',         onNavigate as EventListener)
      wv.removeEventListener('did-navigate-in-page',  onNavigate as EventListener)
      wv.removeEventListener('did-start-loading',     onStartLoading as EventListener)
      wv.removeEventListener('did-stop-loading',      onStopLoading as EventListener)
      wv.removeEventListener('page-title-updated',    onTitleUpdate as EventListener)
    }
  }, [activeTabId])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex bg-gray-950 text-gray-100">

      {/* ── Left sidebar — connector list ──────────────────────────────────── */}
      <aside className="w-44 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-3 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Connectors</span>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {CONNECTORS.map(c => {
            const isOpen = tabs.some(t => t.connectorId === c.id)
            const isActive = activeTab?.connectorId === c.id
            return (
              <button
                key={c.id}
                onClick={() => openConnector(c)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <span className={`text-base leading-none ${isActive ? c.color : ''}`}>{c.icon}</span>
                <span className="flex-1 text-left truncate">{c.name}</span>
                {isOpen && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>

        <div className="p-3 border-t border-gray-800">
          <button
            onClick={() => {
              const tab: Tab = { id: genId(), connectorId: null, url: 'https://google.com', title: 'New Tab', loading: true }
              setTabs(prev => [...prev, tab])
              setActiveTabId(tab.id)
              setAddressBar('https://google.com')
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          >
            <span className="text-sm">+</span>
            New Tab
          </button>
        </div>
      </aside>

      {/* ── Main browser area ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Tab bar */}
        {tabs.length > 0 && (
          <div className="flex items-end gap-px bg-gray-900 border-b border-gray-800 px-2 pt-2 overflow-x-auto">
            {tabs.map(tab => {
              const connector = tab.connectorId ? CONNECTORS.find(c => c.id === tab.connectorId) : null
              return (
                <div
                  key={tab.id}
                  onClick={() => { setActiveTabId(tab.id); setAddressBar(tab.url) }}
                  className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs cursor-pointer max-w-[160px] min-w-[80px] transition-colors ${
                    tab.id === activeTabId
                      ? 'bg-gray-950 text-white border border-b-transparent border-gray-800'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                  }`}
                >
                  {connector && (
                    <span className={`flex-shrink-0 ${tab.id === activeTabId ? connector.color : ''}`}>{connector.icon}</span>
                  )}
                  <span className="truncate flex-1">{tab.loading ? '⏳ Loading…' : tab.title}</span>
                  <span
                    onClick={(e) => closeTab(tab.id, e)}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-gray-600 transition-all"
                  >
                    ✕
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Navigation toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800">
          <button
            onClick={() => webviewRef.current?.goBack()}
            disabled={!canBack}
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Back"
          >
            ←
          </button>
          <button
            onClick={() => webviewRef.current?.goForward()}
            disabled={!canFwd}
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Forward"
          >
            →
          </button>
          <button
            onClick={() => webviewRef.current?.reload()}
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            title="Reload"
          >
            ↻
          </button>

          {/* Address bar */}
          <input
            type="text"
            value={addressBar}
            onChange={e => setAddressBar(e.target.value)}
            onKeyDown={handleAddressKeyDown}
            placeholder="Enter URL or search…"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors font-mono"
          />

          <button
            onClick={() => navigate(addressBar)}
            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            title="Go"
          >
            ↵
          </button>

          {/* Active tab loading indicator */}
          {activeTab?.loading && (
            <span className="text-xs text-gray-500 animate-pulse">Loading…</span>
          )}
        </div>

        {/* Webview area */}
        <div className="flex-1 relative bg-gray-950">
          {activeTab ? (
            <webview
              ref={webviewRef as React.RefObject<HTMLElement & WebviewElement>}
              key={activeTab.id}
              src={activeTab.url}
              partition={`persist:browser-${activeTab.connectorId ?? 'custom'}`}
              allowpopups="true"
              webpreferences="contextIsolation=true"
              style={{ width: '100%', height: '100%', display: 'flex' }}
              className="w-full h-full"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <div className="text-5xl mb-4">🔗</div>
              <div className="text-lg font-medium mb-2">No tab open</div>
              <div className="text-sm">Pick a connector from the sidebar or open a new tab.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
