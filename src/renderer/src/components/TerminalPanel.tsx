/**
 * TerminalPanel — a full xterm.js terminal panel with multi-tab support.
 *
 * Features:
 *  - Multiple named tabs, each a separate PTY session
 *  - Drag-to-resize handle (vertical)
 *  - Auto-fits xterm.js to container size via FitAddon + ResizeObserver
 *  - Clickable hyperlinks via WebLinksAddon
 *  - Dark/light theme support
 *  - "New tab" button and per-tab close button
 *  - Shows exit code banner when the shell process exits
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

// ── Color themes ─────────────────────────────────────────────────────────────

const DARK_THEME = {
  background:         '#0f0f0f',
  foreground:         '#e4e4e4',
  cursor:             '#ffffff',
  cursorAccent:       '#000000',
  selectionBackground:'#3b4261aa',
  black:   '#1a1a2e', red:     '#f7768e', green:   '#9ece6a', yellow:  '#e0af68',
  blue:    '#7aa2f7', magenta: '#bb9af7', cyan:    '#7dcfff', white:   '#c0caf5',
  brightBlack:   '#414868', brightRed:     '#f7768e', brightGreen:   '#9ece6a',
  brightYellow:  '#e0af68', brightBlue:    '#7aa2f7', brightMagenta: '#bb9af7',
  brightCyan:    '#7dcfff', brightWhite:   '#c0caf5',
}

const LIGHT_THEME = {
  background:         '#f9fafb',
  foreground:         '#1f2937',
  cursor:             '#1f2937',
  cursorAccent:       '#f9fafb',
  selectionBackground:'#bfdbfe',
  black:   '#1f2937', red:     '#dc2626', green:   '#16a34a', yellow:  '#d97706',
  blue:    '#2563eb', magenta: '#7c3aed', cyan:    '#0891b2', white:   '#f3f4f6',
  brightBlack:   '#6b7280', brightRed:     '#ef4444', brightGreen:   '#22c55e',
  brightYellow:  '#f59e0b', brightBlue:    '#3b82f6', brightMagenta: '#a855f7',
  brightCyan:    '#06b6d4', brightWhite:   '#ffffff',
}

// ── Tab types ─────────────────────────────────────────────────────────────────

interface TermTab {
  id:        string   // unique tab id (≠ PTY sessionId)
  sessionId: string   // PTY session id from main process
  title:     string
  exited:    boolean
  exitCode:  number | null
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  workspacePath: string
  theme:         'dark' | 'light'
  height:        number
  onHeightChange:(h: number) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TerminalPanel({ workspacePath, theme, height, onHeightChange }: Props) {
  const [tabs, setTabs]           = useState<TermTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Per-tab xterm.js instances and their fit addons
  const termRefs  = useRef<Map<string, Terminal>>(new Map())
  const fitRefs   = useRef<Map<string, FitAddon>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const tabContentRef = useRef<HTMLDivElement>(null)

  // ── Theme switch ────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = theme === 'dark' ? DARK_THEME : LIGHT_THEME
    termRefs.current.forEach(term => term.options.theme = t)
  }, [theme])

  // ── IPC listeners ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.api) return

    window.api.onTerminalData(({ sessionId, data }) => {
      // Find the tab for this session and write to its terminal
      setTabs(prev => {
        const tab = prev.find(t => t.sessionId === sessionId)
        if (tab) {
          const term = termRefs.current.get(tab.id)
          if (term) term.write(data)
        }
        return prev  // no state change needed
      })
    })

    window.api.onTerminalExit(({ sessionId, exitCode }) => {
      setTabs(prev => prev.map(t =>
        t.sessionId === sessionId ? { ...t, exited: true, exitCode } : t
      ))
    })

    return () => window.api.removeTerminalListeners()
  }, [])

  // ── Create a new tab + PTY ───────────────────────────────────────────────────
  const createTab = useCallback(async () => {
    if (!window.api || !tabContentRef.current) return

    const tabId = `tab-${Date.now()}`

    // Create a container div for this tab
    const el = document.createElement('div')
    el.style.cssText = 'width:100%;height:100%;display:none;'
    el.dataset.tabid = tabId
    tabContentRef.current.appendChild(el)

    // Instantiate xterm.js
    const term = new Terminal({
      fontFamily:    '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      fontSize:      13,
      lineHeight:    1.3,
      cursorBlink:   true,
      cursorStyle:   'bar',
      scrollback:    5000,
      theme:         theme === 'dark' ? DARK_THEME : LIGHT_THEME,
      allowProposedApi: true,
    })

    const fitAddon   = new FitAddon()
    const linksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(linksAddon)
    term.open(el)
    fitAddon.fit()

    termRefs.current.set(tabId, term)
    fitRefs.current.set(tabId, fitAddon)

    const { cols, rows } = term

    // Create PTY session in main
    const result = await window.api.createTerminal(workspacePath, cols, rows)
    if (result.error || !result.sessionId) {
      term.write(`\r\n\x1b[31mFailed to start terminal: ${result.error ?? 'unknown error'}\x1b[0m\r\n`)
    }

    // Pipe keystrokes → PTY
    term.onData((data: string) => {
      if (result.sessionId) window.api.writeTerminal(result.sessionId, data)
    })

    const tabNum = (tabs.length + 1).toString()
    const newTab: TermTab = {
      id:        tabId,
      sessionId: result.sessionId,
      title:     `Shell ${tabNum}`,
      exited:    false,
      exitCode:  null
    }

    setTabs(prev => [...prev, newTab])
    setActiveTabId(tabId)
  }, [workspacePath, theme, tabs.length])

  // ── Show/hide tab content when active changes ────────────────────────────────
  useEffect(() => {
    if (!tabContentRef.current) return
    const children = Array.from(tabContentRef.current.children) as HTMLDivElement[]
    children.forEach(el => {
      el.style.display = el.dataset.tabid === activeTabId ? 'block' : 'none'
    })
    // Re-fit after tab switch
    if (activeTabId) {
      const fitAddon = fitRefs.current.get(activeTabId)
      if (fitAddon) setTimeout(() => { try { fitAddon.fit() } catch { /* ignore */ } }, 0)
    }
  }, [activeTabId])

  // ── Auto-fit on resize ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!tabContentRef.current) return
    const ro = new ResizeObserver(() => {
      if (!activeTabId) return
      const fitAddon = fitRefs.current.get(activeTabId)
      if (!fitAddon) return
      try {
        fitAddon.fit()
        const term = termRefs.current.get(activeTabId)
        if (term) {
          const tab = tabs.find(t => t.id === activeTabId)
          if (tab?.sessionId) {
            window.api.resizeTerminal(tab.sessionId, term.cols, term.rows)
          }
        }
      } catch { /* ignore */ }
    })
    ro.observe(tabContentRef.current)
    return () => ro.disconnect()
  }, [activeTabId, tabs])

  // ── Create first tab on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (tabs.length === 0 && window.api) {
      createTab()
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── "Run in terminal" event from MessageBubble code blocks ───────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { code } = (e as CustomEvent<{ code: string }>).detail
      if (!code) return

      // Find the active tab's session
      const tab = tabs.find(t => t.id === activeTabId)
      if (!tab?.sessionId) return

      // Paste the code + newline into the PTY
      window.api.writeTerminal(tab.sessionId, code.trimEnd() + '\n')
    }
    window.addEventListener('run-in-terminal', handler)
    return () => window.removeEventListener('run-in-terminal', handler)
  }, [tabs, activeTabId])

  // ── Close a tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.sessionId) window.api.killTerminal(tab.sessionId)

    // Remove xterm instance
    const term = termRefs.current.get(tabId)
    if (term) { term.dispose(); termRefs.current.delete(tabId) }
    fitRefs.current.delete(tabId)

    // Remove DOM node
    if (tabContentRef.current) {
      const el = tabContentRef.current.querySelector(`[data-tabid="${tabId}"]`)
      if (el) el.remove()
    }

    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId)
      if (activeTabId === tabId) {
        setActiveTabId(remaining[remaining.length - 1]?.id ?? null)
      }
      return remaining
    })
  }, [tabs, activeTabId])

  // ── Drag-to-resize ───────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY  = e.clientY
    const startH  = height

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY  // dragging up = taller
      onHeightChange(Math.max(120, Math.min(800, startH + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [height, onHeightChange])

  // ── Colours ───────────────────────────────────────────────────────────────────
  const isDark   = theme === 'dark'
  const bg       = isDark ? 'bg-[#0f0f0f]'  : 'bg-gray-50'
  const headerBg = isDark ? 'bg-[#1a1a1a]'  : 'bg-gray-100'
  const borderCl = isDark ? 'border-gray-800' : 'border-gray-200'
  const tabActive= isDark
    ? 'bg-[#0f0f0f] text-gray-100 border-b-[#0f0f0f]'
    : 'bg-white text-gray-900 border-b-white'
  const tabInactive = isDark
    ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'

  return (
    <div
      className={`flex flex-col ${bg} border-t ${borderCl} flex-shrink-0 select-none`}
      style={{ height }}
    >
      {/* ── Drag handle ── */}
      <div
        onMouseDown={handleDragStart}
        className={`h-[4px] cursor-row-resize flex-shrink-0 hover:bg-blue-500 transition-colors ${borderCl} border-t`}
        style={{ marginTop: -4 }}
        title="Drag to resize"
      />

      {/* ── Tab bar ── */}
      <div className={`flex items-center gap-0 ${headerBg} border-b ${borderCl} flex-shrink-0 overflow-x-auto`}
           style={{ minHeight: 34 }}>

        {/* Tabs */}
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`
              flex items-center gap-1.5 px-3 h-[34px] text-xs font-mono cursor-pointer
              border-r ${borderCl} flex-shrink-0
              ${activeTabId === tab.id ? tabActive : tabInactive}
              transition-colors
            `}
          >
            {/* Shell icon */}
            <svg className="w-3 h-3 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3" />
            </svg>

            <span className="max-w-[120px] truncate">
              {tab.title}
              {tab.exited && (
                <span className={tab.exitCode === 0 ? 'text-green-500' : 'text-red-500'}>
                  {' '}[{tab.exitCode}]
                </span>
              )}
            </span>

            {/* Close */}
            <button
              onClick={e => closeTab(tab.id, e)}
              className="ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded opacity-50 hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 transition-colors flex-shrink-0"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {/* New tab button */}
        <button
          onClick={createTab}
          className={`flex items-center justify-center w-8 h-[34px] flex-shrink-0 ${tabInactive} transition-colors`}
          title="New terminal  (Ctrl+`)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Clear button */}
        {activeTabId && (
          <button
            onClick={() => {
              const term = termRefs.current.get(activeTabId)
              if (term) term.clear()
            }}
            className={`px-2 h-[34px] text-xs ${tabInactive} transition-colors mr-1`}
            title="Clear terminal"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Terminal content area ── */}
      <div
        ref={tabContentRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '4px 0 0 4px' }}
      />

      {/* Empty state */}
      {tabs.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          <button
            onClick={createTab}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3" />
            </svg>
            Open terminal
          </button>
        </div>
      )}
    </div>
  )
}
