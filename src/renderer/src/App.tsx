import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { AppSettings, Conversation, DEFAULT_SETTINGS, DiffRequestPayload, DiffAttachPayload, UpdateStatusPayload } from '../../shared/types'
import Sidebar from './components/Sidebar'
import ChatWindow, { ChatWindowHandle } from './components/ChatWindow'
import Settings from './components/Settings'
import DiffViewer from './components/DiffViewer'
import UpdateBanner from './components/UpdateBanner'
import ConversationSearch from './components/ConversationSearch'
import CmdApprovalModal from './components/CmdApprovalModal'
import CommandPalette, { PaletteCommand } from './components/CommandPalette'
import OnboardingWizard from './components/OnboardingWizard'
import ErrorBoundary from './components/ErrorBoundary'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { CmdApprovalPayload } from '../../shared/types'

const TerminalPanel         = lazy(() => import('./components/TerminalPanel'))
const CodeEditorPanel       = lazy(() => import('./components/CodeEditorPanel'))
const CostDashboard         = lazy(() => import('./components/CostDashboard'))
const MemoryPanel           = lazy(() => import('./components/MemoryPanel'))
const CompareView           = lazy(() => import('./components/CompareView'))
const GitHubPanel           = lazy(() => import('./components/GitHubPanel'))
const ScheduledTasksPanel   = lazy(() => import('./components/ScheduledTasksPanel'))
const AgentPresetsPanel     = lazy(() => import('./components/AgentPresetsPanel'))
const JiraLinearPanel       = lazy(() => import('./components/JiraLinearPanel'))
const KeyboardShortcutsModal = lazy(() => import('./components/KeyboardShortcutsModal'))
const FeatureTour           = lazy(() => import('./components/FeatureTour'))
const LogViewerPanel        = lazy(() => import('./components/LogViewerPanel'))
const DockerManagerPanel    = lazy(() => import('./components/DockerManagerPanel'))
const HttpBuilderPanel      = lazy(() => import('./components/HttpBuilderPanel'))
const DependencyAuditPanel  = lazy(() => import('./components/DependencyAuditPanel'))
const EmbeddedBrowserPanel  = lazy(() => import('./components/EmbeddedBrowserPanel'))

type View = 'chat' | 'settings' | 'compare'

const isElectron = typeof window !== 'undefined' && !!window.api

export default function App() {
  const [settings, setSettings]           = useState<AppSettings>(DEFAULT_SETTINGS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId]   = useState<string | null>(null)
  // chatWindowKey drives the `key` prop on <ChatWindow>.  It only changes on
  // deliberate user navigation (sidebar click, new chat, etc.) — NOT on first
  // save of a new conversation.  That prevents React from unmounting + remounting
  // ChatWindow (and killing stream listeners) mid-flight when the first message
  // of a new chat triggers onConversationUpdate → setActiveConvId.
  const [chatWindowKey, setChatWindowKey] = useState<string>('new')

  // Single helper that changes both activeConvId AND the ChatWindow key.
  // Use this for every explicit navigation; handleConversationUpdate uses
  // setActiveConvId directly so it doesn't change the key.
  const navigateTo = useCallback((id: string | null) => {
    setActiveConvId(id)
    setChatWindowKey(id ?? `new-${Date.now()}`)
  }, [])

  const [view, setView]                   = useState<View>('chat')
  const [loaded, setLoaded]               = useState(false)
  const [pendingDiff, setPendingDiff]     = useState<DiffRequestPayload | null>(null)
  const [acceptAllActive, setAcceptAllActive] = useState(false)
  const [updateStatus, setUpdateStatus]   = useState<UpdateStatusPayload | null>(null)
  const [terminalOpen, setTerminalOpen]   = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(280)
  const [searchOpen,       setSearchOpen]       = useState(false)
  const [pendingScrollMsgId, setPendingScrollMsgId] = useState<string | null>(null)
  const [costsOpen,        setCostsOpen]        = useState(false)
  const [globalMemoryOpen, setGlobalMemoryOpen] = useState(false)
  const [pendingCmd,       setPendingCmd]       = useState<CmdApprovalPayload | null>(null)
  const [githubOpen,       setGithubOpen]       = useState(false)
  const [schedulerOpen,    setSchedulerOpen]    = useState(false)
  const [shortcutsOpen,    setShortcutsOpen]    = useState(false)
  const [paletteOpen,      setPaletteOpen]      = useState(false)
  const [presetsOpen,      setPresetsOpen]      = useState(false)
  const [jiraLinearOpen,   setJiraLinearOpen]   = useState(false)
  const [showOnboarding,   setShowOnboarding]   = useState(false)
  const [featureTourOpen,  setFeatureTourOpen]  = useState(false)
  const [logsOpen,         setLogsOpen]         = useState(false)
  const [dockerOpen,       setDockerOpen]       = useState(false)
  const [httpBuilderOpen,  setHttpBuilderOpen]  = useState(false)
  const [depAuditOpen,     setDepAuditOpen]     = useState(false)
  const [browserOpen,      setBrowserOpen]      = useState(false)
  const [editorOpen,       setEditorOpen]       = useState(false)
  const [editorWidthPct,   setEditorWidthPct]   = useState(58)   // % of flex-1 area
  const [chatWorkspace,    setChatWorkspace]    = useState<string | undefined>(undefined)

  const importInputRef = useRef<HTMLInputElement>(null)
  const chatRef = useRef<ChatWindowHandle>(null)

  // ── Editor resize drag ─────────────────────────────────────────────────────
  const editorResizing = useRef(false)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  const startEditorResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    editorResizing.current = true
    const onMove = (me: MouseEvent) => {
      if (!editorResizing.current || !editorContainerRef.current) return
      const rect = editorContainerRef.current.getBoundingClientRect()
      const pct  = Math.round(((rect.right - me.clientX) / rect.width) * 100)
      setEditorWidthPct(Math.min(85, Math.max(20, pct)))
    }
    const onUp = () => { editorResizing.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // ── Theme sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    const theme = settings.theme ?? 'dark'

    const applyTheme = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark',  isDark)
      document.documentElement.classList.toggle('light', !isDark)
      if (isElectron) window.api.setTitleBarTheme(isDark ? 'dark' : 'light')
    }

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mq.matches)
      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches)
      mq.addEventListener('change', listener)
      localStorage.setItem('theme', theme)
      return () => mq.removeEventListener('change', listener)
    } else {
      applyTheme(theme === 'dark')
      localStorage.setItem('theme', theme)
    }
  }, [settings.theme])

  // ── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) { setLoaded(true); return }

    Promise.all([
      window.api.getSettings(),
      window.api.listConversations()
    ]).then(([s, convs]) => {
      if (!s.theme) s.theme = 'dark'
      if (s.workspacePath === undefined) s.workspacePath = ''
      setSettings(s)
      if (!s.onboardingComplete && !s.apiKey) {
        setShowOnboarding(true)
      }
      setConversations(convs)
      if (convs.length > 0) navigateTo(convs[0].id)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  // ── Diff request listener ─────────────────────────────────────────────────
  // Keep acceptAllActive accessible inside the callback via a ref
  const acceptAllRef = useRef(false)
  acceptAllRef.current = acceptAllActive

  // Track diff IDs that are being shown inline (in tool call cards) to skip the modal
  const inlineDiffIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isElectron) return
    // Listen for inline diff attachments BEFORE diff requests so the ref is populated
    window.api.onDiffAttach((payload: DiffAttachPayload) => {
      inlineDiffIdsRef.current.add(payload.diffId)
      // Forward to useChat.ts via DOM event so it can update the tool card
      window.dispatchEvent(new CustomEvent('diff-attach', { detail: payload }))
    })
    window.api.onDiffRequest((payload) => {
      // If shown inline, skip the modal (but still handle Accept All)
      if (inlineDiffIdsRef.current.has(payload.id)) {
        if (acceptAllRef.current) {
          window.api.respondDiff({ id: payload.id, approved: true })
        }
        return
      }
      // Original behavior
      if (acceptAllRef.current) {
        // Auto-approve without showing the modal
        window.api.respondDiff({ id: payload.id, approved: true })
      } else {
        setPendingDiff(payload)
      }
    })
  }, [])

  // ── Shell command approval listener ──────────────────────────────────────
  // This is the SINGLE IPC listener for CMD_APPROVAL_REQUEST.
  // It both shows the modal AND dispatches a DOM event so useChat.ts can
  // flip the tool card to 'awaiting-approval' without needing its own IPC listener.
  useEffect(() => {
    if (!isElectron) return
    window.api.onCmdApproval((payload) => {
      setPendingCmd(payload)
      // Let useChat.ts know so it can update the tool card state
      window.dispatchEvent(new CustomEvent('cmd-approval-pending', { detail: payload }))
    })
    // This listener lives for the full app lifetime — do NOT remove it on cleanup.
  }, [])

  // ── Scheduled task fire listener ──────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return
    window.api.onScheduleFire((payload) => {
      // Switch to chat view and dispatch the scheduled prompt as a custom event
      setView('chat')
      navigateTo(null)
      // Use a small delay to let ChatWindow mount if we just cleared the conv
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('schedule-fire-prompt', { detail: { prompt: payload.prompt } }))
      }, 150)
    })
  }, [])

  // ── Start HTTP API server if enabled ─────────────────────────────────────
  useEffect(() => {
    if (!isElectron || !loaded) return
    if (settings.apiServerEnabled) {
      window.api.toggleApiServer(true, settings.apiServerPort ?? 39400)
    }
    return () => {
      if (settings.apiServerEnabled) {
        window.api.toggleApiServer(false, 0)
      }
    }
  }, [loaded, settings.apiServerEnabled, settings.apiServerPort])

  // ── Update status listener ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return
    window.api.onUpdateStatus((payload) => {
      // Don't surface 'checking' or 'not-available' — those are silent states
      if (payload.type === 'checking' || payload.type === 'not-available') return
      setUpdateStatus(payload)
    })
    return () => window.api.removeUpdateListeners()
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const goNextConv = useCallback(() => {
    if (conversations.length === 0) return
    const idx = conversations.findIndex(c => c.id === activeConvId)
    const next = conversations[idx + 1]
    if (next) { navigateTo(next.id); setView('chat') }
  }, [conversations, activeConvId, navigateTo])

  const goPrevConv = useCallback(() => {
    if (conversations.length === 0) return
    const idx = conversations.findIndex(c => c.id === activeConvId)
    const prev = conversations[idx - 1]
    if (prev) { navigateTo(prev.id); setView('chat') }
  }, [conversations, activeConvId, navigateTo])

  const toggleTerminal = useCallback(() => setTerminalOpen(v => !v), [])
  const openSearch     = useCallback(() => setSearchOpen(true), [])
  // pendingNewChatWorkspace: when a "New chat in folder X" is clicked, we stash
  // the folder here so ChatWindow picks it up on first message.
  const [pendingNewChatWorkspace, setPendingNewChatWorkspace] = useState<string | null>(null)
  // pendingAgentTask: when user clicks "Fix with Agent" on a GitHub issue, stash
  // the prompt here so ChatWindow auto-sends it in agent mode.
  const [pendingAgentTask, setPendingAgentTask] = useState<string | null>(null)
  const startNewChat = useCallback((workspacePath?: string) => {
    navigateTo(null)
    setView('chat')
    setPendingNewChatWorkspace(workspacePath ?? null)
  }, [navigateTo])

  // "New chat" button inside the context-limit warning banner
  useEffect(() => {
    const handler = () => startNewChat()
    window.addEventListener('new-chat-shortcut', handler)
    return () => window.removeEventListener('new-chat-shortcut', handler)
  }, [startNewChat])

  useKeyboardShortcuts({
    onNewChat:       startNewChat,
    onOpenSettings:  useCallback(() => setView('settings'), []),
    onCloseSettings: useCallback(() => {
      if (pendingDiff) return  // don't close settings while diff is pending
      if (searchOpen) { setSearchOpen(false); return }
      if (view === 'settings') setView('chat')
    }, [view, pendingDiff, searchOpen]),
    onFocusInput:    useCallback(() => { setView('chat'); chatRef.current?.focusInput() }, []),
    onPrevConv:      goPrevConv,
    onNextConv:      goNextConv,
    onToggleTerminal: toggleTerminal,
    onOpenSearch:    openSearch,
    onOpenShortcuts: useCallback(() => setShortcutsOpen(true), []),
  })

  // ── Handle preset apply ─────────────────────────────────────────────────
  const handleApplyPreset = useCallback((preset: import('../../shared/types').AgentPreset) => {
    const next: AppSettings = {
      ...settings,
      provider:     preset.provider,
      model:        preset.model,
      systemPrompt: preset.systemPrompt,
      maxTokens:    preset.maxTokens,
      temperature:  preset.temperature,
      topP:         preset.topP,
    }
    setSettings(next)
    if (isElectron) window.api.saveSettings(next)
    setPresetsOpen(false)
  }, [settings])

  // ── Diff approval handlers ────────────────────────────────────────────────
  const handleDiffApprove = useCallback(() => {
    if (!pendingDiff || !isElectron) return
    window.api.respondDiff({ id: pendingDiff.id, approved: true })
    setPendingDiff(null)
  }, [pendingDiff])

  const handleDiffAcceptAll = useCallback(() => {
    if (!pendingDiff || !isElectron) return
    setAcceptAllActive(true)
    window.api.respondDiff({ id: pendingDiff.id, approved: true })
    setPendingDiff(null)
  }, [pendingDiff])

  const handleDiffReject = useCallback(() => {
    if (!pendingDiff || !isElectron) return
    window.api.respondDiff({ id: pendingDiff.id, approved: false })
    setPendingDiff(null)
  }, [pendingDiff])

  // ── Cmd+K / Ctrl+K → command palette ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Reset "Accept All" when a new stream starts (new agent turn)
  useEffect(() => {
    const handler = () => setAcceptAllActive(false)
    window.addEventListener('agent-send-continue', handler)
    // Also reset when the user sends a new message
    window.addEventListener('chat-new-message', handler)
    return () => {
      window.removeEventListener('agent-send-continue', handler)
      window.removeEventListener('chat-new-message', handler)
    }
  }, [])

  // Enter = approve, Escape = reject when diff modal is open
  useEffect(() => {
    if (!pendingDiff) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleDiffApprove() }
      if (e.key === 'Escape') { e.preventDefault(); handleDiffReject() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingDiff, handleDiffApprove, handleDiffReject])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleTheme = async () => {
    const cycle: Record<string, 'dark' | 'light' | 'system'> = { dark: 'light', light: 'system', system: 'dark' }
    const next: AppSettings = {
      ...settings,
      theme: cycle[settings.theme ?? 'dark'] ?? 'light'
    }
    setSettings(next)
    if (isElectron) window.api.saveSettings(next)
  }

  const setTheme = async (theme: 'dark' | 'light' | 'system') => {
    const next: AppSettings = { ...settings, theme }
    setSettings(next)
    if (isElectron) window.api.saveSettings(next)
  }

  const handleSaveSettings = async (s: AppSettings) => {
    if (isElectron) await window.api.saveSettings(s)
    setSettings(s)
    setView('chat')
  }

  const handleConversationUpdate = (conv: Conversation) => {
    setConversations(prev => {
      const idx = prev.findIndex(c => c.id === conv.id)
      if (idx >= 0) { const u = [...prev]; u[idx] = conv; return u }
      return [conv, ...prev]
    })
    setActiveConvId(conv.id)
  }

  const handleDeleteConversation = async (id: string) => {
    if (isElectron) await window.api.deleteConversation(id)
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeConvId === id) navigateTo(null)
  }

  const handleSwitchWorkspace = async (path: string) => {
    const next: AppSettings = { ...settings, workspacePath: path }
    if (isElectron) await window.api.saveSettings(next)
    setSettings(next)
    setView('chat')
  }

  const handleRenameConversation = async (id: string, title: string) => {
    const conv = conversations.find(c => c.id === id)
    if (!conv) return
    const updated = { ...conv, title }
    if (isElectron) await window.api.saveConversation(updated)
    setConversations(prev => prev.map(c => c.id === id ? updated : c))
  }

  const handleExportAllConversations = async () => {
    if (!isElectron) return
    await window.api.exportAllConversations()
  }

  const handleImportAllConversations = async () => {
    if (!isElectron) return
    const result = await window.api.importAllConversations()
    if (result.ok) {
      const convs = await window.api.listConversations()
      setConversations(convs)
    }
  }

  const handleTagChange = async (id: string, tags: string[]) => {
    const conv = conversations.find(c => c.id === id)
    if (!conv) return
    const updated = { ...conv, tags }
    if (isElectron) await window.api.saveConversation(updated)
    setConversations(prev => prev.map(c => c.id === id ? updated : c))
  }

  // ── Import conversation from file ─────────────────────────────────────────
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const text = await file.text()

    let newConv: Conversation

    // ── JSON import (exported from this app) ──────────────────────────────
    if (file.name.endsWith('.json')) {
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { alert('Invalid JSON file.'); return }
      const p = parsed as Record<string, unknown>
      if (!p || typeof p !== 'object' || !Array.isArray(p.messages)) {
        alert('JSON file does not look like a valid conversation export.'); return
      }
      newConv = {
        ...(p as Conversation),
        // Give it a fresh id to avoid collisions; preserve original title
        id:        `imported-${Date.now()}`,
        updatedAt: Date.now(),
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
        title:     (typeof p.title === 'string' && p.title) ? p.title : file.name.replace(/\.[^/.]+$/, ''),
        provider:  (p.provider as string) || settings.provider,
        model:     (p.model as string)    || settings.model,
      }
    } else {
      // ── Markdown / text import ──────────────────────────────────────────
      const messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }> = []
      const headingPattern = /^#{1,3}\s+(User|Human|Assistant|AI)\s*$/gim
      const parts = text.split(headingPattern).map((s: string) => s.trim()).filter(Boolean)
      if (parts.length >= 2 && /^(User|Human|Assistant|AI)$/i.test(parts[0])) {
        for (let i = 0; i + 1 < parts.length; i += 2) {
          const roleRaw = parts[i].toLowerCase()
          const msgContent = parts[i + 1]
          const role: 'user' | 'assistant' = roleRaw === 'user' || roleRaw === 'human' ? 'user' : 'assistant'
          if (msgContent) messages.push({ id: `imp-${i}`, role, content: msgContent, timestamp: Date.now() - (parts.length - i) * 1000 })
        }
      } else {
        messages.push({ id: 'imp-0', role: 'user', content: text.slice(0, 20_000), timestamp: Date.now() })
      }
      if (messages.length === 0) return
      newConv = {
        id:        `imported-${Date.now()}`,
        title:     file.name.replace(/\.[^/.]+$/, '') || 'Imported conversation',
        messages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        provider:  settings.provider,
        model:     settings.model,
      }
    }

    if (isElectron) await window.api.saveConversation(newConv)
    const updated = isElectron ? await window.api.listConversations() : [newConv, ...conversations]
    setConversations(updated)
    navigateTo(newConv.id)
    setView('chat')
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!isElectron) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-950 text-gray-500 flex-col gap-4">
        <div className="text-5xl">⚡</div>
        <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-200">AI Code App</h1>
        <p className="text-sm text-center max-w-sm">
          Run <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-blue-500 text-xs">npm run dev</code> to launch inside Electron.
        </p>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-950 text-gray-400">
        <div className="animate-pulse">Loading…</div>
      </div>
    )
  }

  // ── Command palette commands ─────────────────────────────────────────────
  const activeConv = conversations.find(c => c.id === activeConvId)
  const paletteCommands: PaletteCommand[] = [
    // ── Chat ──────────────────────────────────────────────────────────────
    {
      id: 'new-chat',
      label: 'New Chat',
      icon: '💬',
      category: 'chat',
      shortcut: 'Ctrl+N',
      description: 'Start a fresh conversation',
      keywords: ['new', 'create', 'start'],
      action: () => startNewChat(),
    },
    {
      id: 'focus-input',
      label: 'Focus Input',
      icon: '⌨️',
      category: 'chat',
      shortcut: 'Ctrl+L',
      description: 'Jump to the message input',
      action: () => { setView('chat'); chatRef.current?.focusInput() },
    },
    // ── Navigation ────────────────────────────────────────────────────────
    {
      id: 'search',
      label: 'Search Conversations',
      icon: '🔍',
      category: 'navigation',
      shortcut: 'Ctrl+F',
      description: 'Full-text search across all conversations',
      keywords: ['find', 'search', 'history'],
      action: () => setSearchOpen(true),
    },
    {
      id: 'prev-conv',
      label: 'Previous Conversation',
      icon: '↑',
      category: 'navigation',
      shortcut: 'Alt+↑',
      description: 'Switch to the previous conversation in the list',
      action: goPrevConv,
      disabled: conversations.length < 2,
    },
    {
      id: 'next-conv',
      label: 'Next Conversation',
      icon: '↓',
      category: 'navigation',
      shortcut: 'Alt+↓',
      description: 'Switch to the next conversation in the list',
      action: goNextConv,
      disabled: conversations.length < 2,
    },
    // Recent conversations
    ...conversations.slice(0, 8).map(c => ({
      id: `conv-${c.id}`,
      label: c.title || 'Untitled Chat',
      icon: c.id === activeConvId ? '✅' : '💬',
      category: 'navigation' as const,
      description: `Switch to this conversation`,
      keywords: ['conversation', 'chat', 'switch'],
      action: () => { setActiveConvId(c.id); setView('chat') },
    })),
    // ── Workspace ─────────────────────────────────────────────────────────
    {
      id: 'open-workspace',
      label: 'Open Workspace Folder',
      icon: '📁',
      category: 'workspace',
      description: 'Pick a folder to use as workspace for the current chat',
      keywords: ['folder', 'directory', 'workspace', 'open'],
      action: () => { setView('chat'); setTimeout(() => chatRef.current?.focusInput(), 100) },
    },
    {
      id: 'open-terminal',
      label: 'Toggle Terminal',
      icon: '🖥️',
      category: 'workspace',
      shortcut: 'Ctrl+`',
      description: 'Show or hide the integrated terminal panel',
      keywords: ['terminal', 'console', 'shell'],
      action: () => { setView('chat'); toggleTerminal() },
    },
    // ── View ──────────────────────────────────────────────────────────────
    {
      id: 'open-settings',
      label: 'Open Settings',
      icon: '⚙️',
      category: 'settings',
      shortcut: 'Ctrl+,',
      description: 'API keys, model selection, and preferences',
      keywords: ['config', 'preferences', 'api key', 'model'],
      action: () => setView('settings'),
    },
    {
      id: 'open-shortcuts',
      label: 'Keyboard Shortcuts',
      icon: '⌨️',
      category: 'view',
      shortcut: 'Ctrl+/',
      description: 'View all keyboard shortcuts',
      keywords: ['hotkeys', 'shortcuts', 'keyboard'],
      action: () => setShortcutsOpen(true),
    },
    {
      id: 'open-costs',
      label: 'Cost Dashboard',
      icon: '💰',
      category: 'view',
      description: 'View token usage and cost breakdown',
      keywords: ['cost', 'usage', 'tokens', 'billing'],
      action: () => setCostsOpen(true),
    },
    {
      id: 'open-github',
      label: 'GitHub Panel',
      icon: '🐙',
      category: 'view',
      description: 'Browse issues, PRs and repos',
      keywords: ['github', 'issues', 'pull requests'],
      action: () => { setView('chat'); setGithubOpen(true) },
    },
    {
      id: 'theme-toggle',
      label: 'Toggle Theme',
      icon: '🌙',
      category: 'view',
      description: `Cycle through dark → light → system (currently: ${settings.theme ?? 'dark'})`,
      keywords: ['dark', 'light', 'theme', 'color', 'mode'],
      action: toggleTheme,
    },
    {
      id: 'export-all',
      label: 'Export All Conversations',
      icon: '📤',
      category: 'navigation',
      description: 'Download all conversations as a JSON backup',
      keywords: ['export', 'backup', 'download'],
      action: handleExportAllConversations,
    },
    // ── Current conversation actions ──────────────────────────────────────
    ...(activeConv ? [
      {
        id: 'delete-conv',
        label: 'Delete Current Conversation',
        icon: '🗑️',
        category: 'chat' as const,
        description: `Delete "${activeConv.title || 'Untitled Chat'}"`,
        keywords: ['delete', 'remove', 'trash'],
        action: () => handleDeleteConversation(activeConv.id),
      },
    ] : []),
  ]

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-hidden">
      {showOnboarding && (
        <OnboardingWizard
          settings={settings}
          onFinish={(updated) => {
            setSettings(updated)
            setShowOnboarding(false)
          }}
        />
      )}
      <ErrorBoundary name="Sidebar">
        <Sidebar
          conversations={conversations}
          activeConvId={activeConvId}
          settings={settings}
          onNew={startNewChat}
          onSelect={(id) => { navigateTo(id); setView('chat') }}
          onDelete={handleDeleteConversation}
          onRename={handleRenameConversation}
          onOpenSettings={() => setView('settings')}
          onOpenCosts={() => setCostsOpen(true)}
          onOpenGlobalMemory={() => setGlobalMemoryOpen(true)}
          onSwitchWorkspace={handleSwitchWorkspace}
          onToggleTheme={toggleTheme}
          onSetTheme={setTheme}
          onToggleTerminal={toggleTerminal}
          terminalOpen={terminalOpen}
          onOpenSearch={openSearch}
          onOpenCompare={() => setView('compare')}
          onOpenGitHub={() => setGithubOpen(true)}
          onOpenScheduler={() => setSchedulerOpen(true)}
          onOpenPresets={() => setPresetsOpen(true)}
          onOpenJiraLinear={() => setJiraLinearOpen(true)}
          onImport={() => importInputRef.current?.click()}
          onExportAll={handleExportAllConversations}
          onImportAll={handleImportAllConversations}
          onOpenFeatureTour={() => setFeatureTourOpen(true)}
          onOpenLogs={() => setLogsOpen(true)}
          onOpenDocker={settings.features?.dockerManager ? () => setDockerOpen(true) : undefined}
          onOpenHttpBuilder={settings.features?.httpBuilder ? () => setHttpBuilderOpen(true) : undefined}
          onOpenDepAudit={settings.features?.dependencyAudit ? () => setDepAuditOpen(true) : undefined}
          onOpenEmbeddedBrowser={settings.features?.embeddedBrowser ? () => setBrowserOpen(true) : undefined}
          onTagChange={handleTagChange}
        />
      </ErrorBoundary>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {view === 'compare' ? (
          /* ── Multi-model comparison view ── */
          <ErrorBoundary name="Compare View">
            <Suspense fallback={null}>
              <CompareView
                settings={settings}
                onClose={() => setView('chat')}
              />
            </Suspense>
          </ErrorBoundary>
        ) : view === 'chat' ? (
          /* ── Chat + optional editor split + optional terminal ── */
          <ErrorBoundary name="Chat">
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Horizontal split: chat (left) | editor (right) */}
              <div ref={editorContainerRef} className="flex-1 flex overflow-hidden min-h-0">
                {/* Chat pane — shrinks when editor is open */}
                <div
                  className="flex flex-col overflow-hidden min-h-0 min-w-0"
                  style={{ flex: editorOpen ? `0 0 ${100 - editorWidthPct}%` : '1 1 0%' }}
                >
                  <ChatWindow
                    ref={chatRef}
                    key={chatWindowKey}
                    conversation={conversations.find(c => c.id === activeConvId) ?? null}
                    settings={settings}
                    onConversationUpdate={handleConversationUpdate}
                    onSettingsUpdate={(s) => {
                      setSettings(s)
                      if (isElectron) window.api.saveSettings(s)
                    }}
                    onNew={startNewChat}
                    onOpenSearch={() => setSearchOpen(true)}
                    onOpenSettings={() => setView('settings')}
                    initialWorkspacePath={pendingNewChatWorkspace ?? undefined}
                    onWorkspacePathConsumed={() => setPendingNewChatWorkspace(null)}
                    initialAgentTask={pendingAgentTask ?? undefined}
                    onAgentTaskConsumed={() => setPendingAgentTask(null)}
                    onOpenEditor={() => setEditorOpen(true)}
                    onWorkspaceChange={(p) => setChatWorkspace(p)}
                    onNavigateTo={(id) => navigateTo(id)}
                    initialScrollToMsgId={pendingScrollMsgId ?? undefined}
                    onScrollToMsgConsumed={() => setPendingScrollMsgId(null)}
                    updateStatus={updateStatus}
                    onUpdateDownload={() => isElectron && window.api.downloadUpdate()}
                    onUpdateInstall={() => isElectron && window.api.installUpdate()}
                    onUpdateDismiss={() => setUpdateStatus(null)}
                  />
                </div>

                {/* Drag handle between chat and editor */}
                {editorOpen && (
                  <div
                    onMouseDown={startEditorResize}
                    className="w-1 flex-shrink-0 cursor-col-resize bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors active:bg-blue-500"
                    title="Drag to resize"
                  />
                )}

                {/* Editor pane */}
                {editorOpen && (
                  <div
                    className="flex flex-col overflow-hidden min-h-0 min-w-0"
                    style={{ flex: `0 0 ${editorWidthPct}%` }}
                  >
                    <Suspense fallback={
                      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-900 text-gray-400 text-sm">
                        Loading editor…
                      </div>
                    }>
                      <CodeEditorPanel
                        workspacePath={chatWorkspace ?? settings.workspacePath}
                        theme={settings.theme ?? 'dark'}
                        settings={settings}
                        onClose={() => setEditorOpen(false)}
                        onAskAI={(prompt) => {
                          chatRef.current?.setInputText(prompt)
                        }}
                      />
                    </Suspense>
                  </div>
                )}
              </div>

              {/* Terminal panel at the bottom */}
              <Suspense fallback={null}>
                {terminalOpen && (
                  <TerminalPanel
                    workspacePath={settings.workspacePath}
                    theme={settings.theme ?? 'dark'}
                    height={terminalHeight}
                    onHeightChange={setTerminalHeight}
                  />
                )}
              </Suspense>
            </div>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary name="Settings">
            <Settings
              settings={settings}
              onSave={handleSaveSettings}
              onCancel={() => setView('chat')}
            />
          </ErrorBoundary>
        )}
      </div>

      {/* Diff approval modal — rendered over everything */}
      {pendingDiff && (
        <DiffViewer
          payload={pendingDiff}
          onApprove={handleDiffApprove}
          onAcceptAll={handleDiffAcceptAll}
          onReject={handleDiffReject}
        />
      )}

      {/* Command palette (Cmd+K) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
      />

      {/* Full-text conversation search modal */}
      {searchOpen && (
        <ConversationSearch
          conversations={conversations}
          onSelect={(convId, msgId) => {
            navigateTo(convId)
            setPendingScrollMsgId(msgId)
            setView('chat')
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Cost dashboard modal */}
      <Suspense fallback={null}>
        {costsOpen && (
          <CostDashboard onClose={() => setCostsOpen(false)} />
        )}
      </Suspense>

      {/* Global memory modal */}
      <Suspense fallback={null}>
        {globalMemoryOpen && (
          <MemoryPanel
            global
            onClose={() => setGlobalMemoryOpen(false)}
          />
        )}
      </Suspense>

      {/* Shell command approval modal */}
      {pendingCmd && (
        <CmdApprovalModal
          payload={pendingCmd}
          settings={settings}
          onApprove={() => {
            if (isElectron) window.api.respondCmdApproval(pendingCmd.id, true)
            setPendingCmd(null)
          }}
          onReject={() => {
            if (isElectron) window.api.respondCmdApproval(pendingCmd.id, false)
            setPendingCmd(null)
          }}
          onTrust={(prefix) => {
            // Add prefix to trusted commands and save
            const next: AppSettings = {
              ...settings,
              trustedCommands: [...(settings.trustedCommands ?? []), prefix]
            }
            setSettings(next)
            if (isElectron) window.api.saveSettings(next)
          }}
        />
      )}

      {/* GitHub integration panel */}
      <Suspense fallback={null}>
        {githubOpen && (
          <GitHubPanel
            workspacePath={settings.workspacePath ?? ''}
            onClose={() => setGithubOpen(false)}
            onImplementIssue={(issue) => {
              setGithubOpen(false)
              // Start a new agent chat with the issue as the task
              const prompt = [
                `Implement GitHub issue #${issue.number}: **${issue.title}**`,
                '',
                issue.body ? `Issue description:\n${issue.body}` : '',
                '',
                'Please:',
                '1. Analyze the issue and understand what needs to be done',
                '2. Explore the codebase to find relevant files',
                '3. Implement the fix or feature described in the issue',
                '4. Run any existing tests to make sure nothing is broken',
                '5. Create a git commit with a descriptive message referencing the issue number',
              ].filter(l => l !== undefined).join('\n')
              navigateTo(null)
              setView('chat')
              setPendingAgentTask(prompt)
            }}
          />
        )}
      </Suspense>

      {/* Scheduled tasks panel */}
      <Suspense fallback={null}>
        {schedulerOpen && (
          <ScheduledTasksPanel
            settings={settings}
            onClose={() => setSchedulerOpen(false)}
          />
        )}
      </Suspense>

      {/* Keyboard shortcuts help modal */}
      <Suspense fallback={null}>
        {shortcutsOpen && (
          <KeyboardShortcutsModal
            onClose={() => setShortcutsOpen(false)}
          />
        )}
      </Suspense>

      {/* Agent Presets panel */}
      <Suspense fallback={null}>
        {presetsOpen && (
          <AgentPresetsPanel
            settings={settings}
            onApply={handleApplyPreset}
            onClose={() => setPresetsOpen(false)}
          />
        )}
      </Suspense>

      {/* Jira / Linear issues panel */}
      <Suspense fallback={null}>
        {jiraLinearOpen && (
          <JiraLinearPanel
            settings={settings}
            onClose={() => setJiraLinearOpen(false)}
          />
        )}
      </Suspense>

      {/* Feature discovery tour */}
      <Suspense fallback={null}>
        {featureTourOpen && (
          <FeatureTour onClose={() => setFeatureTourOpen(false)} />
        )}
      </Suspense>

      {/* Log viewer */}
      <Suspense fallback={null}>
        {logsOpen && (
          <LogViewerPanel onClose={() => setLogsOpen(false)} />
        )}
      </Suspense>

      {/* Docker manager */}
      <Suspense fallback={null}>
        {dockerOpen && (
          <DockerManagerPanel
            onClose={() => setDockerOpen(false)}
            onAskAI={(prompt) => {
              setDockerOpen(false)
              chatRef.current?.setInputText(prompt)
            }}
            onOpenShell={(command) => {
              // Dispatch to the terminal panel via the existing run-in-terminal event
              window.dispatchEvent(new CustomEvent('run-in-terminal', { detail: { code: command } }))
              setDockerOpen(false)
            }}
          />
        )}
      </Suspense>

      {/* HTTP Builder */}
      <Suspense fallback={null}>
        {httpBuilderOpen && (
          <div className="fixed inset-0 z-50 flex">
            <HttpBuilderPanel
              onClose={() => setHttpBuilderOpen(false)}
              onAskAI={(prompt) => {
                setHttpBuilderOpen(false)
                chatRef.current?.setInputText(prompt)
              }}
            />
          </div>
        )}
      </Suspense>

      {/* Dependency Audit */}
      <Suspense fallback={null}>
        {depAuditOpen && (
          <div className="fixed inset-0 z-50 flex">
            <DependencyAuditPanel
              workspacePath={settings.workspacePath}
              onClose={() => setDepAuditOpen(false)}
              onAskAI={(prompt) => {
                setDepAuditOpen(false)
                chatRef.current?.setInputText(prompt)
              }}
            />
          </div>
        )}
      </Suspense>

      {/* Embedded Browser */}
      <Suspense fallback={null}>
        {browserOpen && (
          <EmbeddedBrowserPanel
            onClose={() => setBrowserOpen(false)}
          />
        )}
      </Suspense>

      {/* Hidden file input for conversation import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".md,.txt"
        className="hidden"
        onChange={handleImportFile}
      />
    </div>
  )
}
