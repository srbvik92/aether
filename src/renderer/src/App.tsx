import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { AppSettings, Conversation, DEFAULT_SETTINGS, DiffRequestPayload, UpdateStatusPayload } from '../../shared/types'
import Sidebar from './components/Sidebar'
import ChatWindow, { ChatWindowHandle } from './components/ChatWindow'
import Settings from './components/Settings'
import DiffViewer from './components/DiffViewer'
import UpdateBanner from './components/UpdateBanner'
import ConversationSearch from './components/ConversationSearch'
import CmdApprovalModal from './components/CmdApprovalModal'
import OnboardingWizard from './components/OnboardingWizard'
import ErrorBoundary from './components/ErrorBoundary'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { CmdApprovalPayload } from '../../shared/types'

const TerminalPanel         = lazy(() => import('./components/TerminalPanel'))
const CostDashboard         = lazy(() => import('./components/CostDashboard'))
const MemoryPanel           = lazy(() => import('./components/MemoryPanel'))
const CompareView           = lazy(() => import('./components/CompareView'))
const GitHubPanel           = lazy(() => import('./components/GitHubPanel'))
const ScheduledTasksPanel   = lazy(() => import('./components/ScheduledTasksPanel'))
const AgentPresetsPanel     = lazy(() => import('./components/AgentPresetsPanel'))
const McpServersPanel       = lazy(() => import('./components/McpServersPanel'))
const JiraLinearPanel       = lazy(() => import('./components/JiraLinearPanel'))
const KeyboardShortcutsModal = lazy(() => import('./components/KeyboardShortcutsModal'))
const FeatureTour           = lazy(() => import('./components/FeatureTour'))
const LogViewerPanel        = lazy(() => import('./components/LogViewerPanel'))

type View = 'chat' | 'settings' | 'compare'

const isElectron = typeof window !== 'undefined' && !!window.api

export default function App() {
  const [settings, setSettings]           = useState<AppSettings>(DEFAULT_SETTINGS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId]   = useState<string | null>(null)
  const [view, setView]                   = useState<View>('chat')
  const [loaded, setLoaded]               = useState(false)
  const [pendingDiff, setPendingDiff]     = useState<DiffRequestPayload | null>(null)
  const [acceptAllActive, setAcceptAllActive] = useState(false)
  const [updateStatus, setUpdateStatus]   = useState<UpdateStatusPayload | null>(null)
  const [terminalOpen, setTerminalOpen]   = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(280)
  const [searchOpen,       setSearchOpen]       = useState(false)
  const [costsOpen,        setCostsOpen]        = useState(false)
  const [globalMemoryOpen, setGlobalMemoryOpen] = useState(false)
  const [pendingCmd,       setPendingCmd]       = useState<CmdApprovalPayload | null>(null)
  const [githubOpen,       setGithubOpen]       = useState(false)
  const [schedulerOpen,    setSchedulerOpen]    = useState(false)
  const [shortcutsOpen,    setShortcutsOpen]    = useState(false)
  const [presetsOpen,      setPresetsOpen]      = useState(false)
  const [mcpOpen,          setMcpOpen]          = useState(false)
  const [jiraLinearOpen,   setJiraLinearOpen]   = useState(false)
  const [showOnboarding,   setShowOnboarding]   = useState(false)
  const [featureTourOpen,  setFeatureTourOpen]  = useState(false)
  const [logsOpen,         setLogsOpen]         = useState(false)

  const importInputRef = useRef<HTMLInputElement>(null)
  const chatRef = useRef<ChatWindowHandle>(null)

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
      if (convs.length > 0) setActiveConvId(convs[0].id)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  // ── Redirect to settings if missing credentials ───────────────────────────
  useEffect(() => {
    if (!loaded) return
    const missingKey = settings.provider === 'gemini'
      ? !settings.vertexProjectId
      : !settings.apiKey
    if (missingKey) setView('settings')
  }, [loaded])

  // ── Diff request listener ─────────────────────────────────────────────────
  // Keep acceptAllActive accessible inside the callback via a ref
  const acceptAllRef = useRef(false)
  acceptAllRef.current = acceptAllActive

  useEffect(() => {
    if (!isElectron) return
    window.api.onDiffRequest((payload) => {
      if (acceptAllRef.current) {
        // Auto-approve without showing the modal
        window.api.respondDiff({ id: payload.id, approved: true })
      } else {
        setPendingDiff(payload)
      }
    })
  }, [])

  // ── Shell command approval listener ──────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return
    window.api.onCmdApproval((payload) => {
      setPendingCmd(payload)
    })
  }, [])

  // ── Scheduled task fire listener ──────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return
    window.api.onScheduleFire((payload) => {
      // Switch to chat view and dispatch the scheduled prompt as a custom event
      setView('chat')
      setActiveConvId(null)
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
    if (next) { setActiveConvId(next.id); setView('chat') }
  }, [conversations, activeConvId])

  const goPrevConv = useCallback(() => {
    if (conversations.length === 0) return
    const idx = conversations.findIndex(c => c.id === activeConvId)
    const prev = conversations[idx - 1]
    if (prev) { setActiveConvId(prev.id); setView('chat') }
  }, [conversations, activeConvId])

  const toggleTerminal = useCallback(() => setTerminalOpen(v => !v), [])
  const openSearch     = useCallback(() => setSearchOpen(true), [])
  const startNewChat   = useCallback(() => { setActiveConvId(null); setView('chat') }, [])

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
    if (activeConvId === id) setActiveConvId(null)
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
    const name = file.name.replace(/\.[^/.]+$/, '')
    const newConv = {
      id: `imported-${Date.now()}`,
      title: name || 'Imported conversation',
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider: settings.provider,
      model: settings.model,
    }
    if (isElectron) await window.api.saveConversation(newConv)
    const updated = isElectron ? await window.api.listConversations() : [newConv, ...conversations]
    setConversations(updated)
    setActiveConvId(newConv.id)
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
          onSelect={(id) => { setActiveConvId(id); setView('chat') }}
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
          onOpenMcp={() => setMcpOpen(true)}
          onOpenJiraLinear={() => setJiraLinearOpen(true)}
          onImport={() => importInputRef.current?.click()}
          onExportAll={handleExportAllConversations}
          onImportAll={handleImportAllConversations}
          onOpenFeatureTour={() => setFeatureTourOpen(true)}
          onOpenLogs={() => setLogsOpen(true)}
          onTagChange={handleTagChange}
        />
      </ErrorBoundary>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Update notification banner */}
        <UpdateBanner
          status={updateStatus}
          onDownload={() => isElectron && window.api.downloadUpdate()}
          onInstall={() => isElectron && window.api.installUpdate()}
          onDismiss={() => setUpdateStatus(null)}
        />

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
          /* ── Chat + optional terminal split ── */
          <ErrorBoundary name="Chat">
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChatWindow
                  ref={chatRef}
                  key={activeConvId ?? 'new'}
                  conversation={conversations.find(c => c.id === activeConvId) ?? null}
                  settings={settings}
                  onConversationUpdate={handleConversationUpdate}
                  onSettingsUpdate={(s) => {
                    setSettings(s)
                    if (isElectron) window.api.saveSettings(s)
                  }}
                  onNew={startNewChat}
                  onOpenSearch={() => setSearchOpen(true)}
                />
              </div>
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

      {/* Full-text conversation search modal */}
      {searchOpen && (
        <ConversationSearch
          conversations={conversations}
          onSelect={(convId) => { setActiveConvId(convId); setView('chat') }}
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

      {/* MCP Servers panel */}
      <Suspense fallback={null}>
        {mcpOpen && (
          <McpServersPanel
            settings={settings}
            onSettingsUpdate={(s) => {
              setSettings(s)
              if (isElectron) window.api.saveSettings(s)
            }}
            onClose={() => setMcpOpen(false)}
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
