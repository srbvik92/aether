import { useState, useEffect, useCallback } from 'react'
import { McpServerConfig, McpOAuthConfig, AppSettings } from '../../../shared/types'

interface Props {
  settings:         AppSettings
  onSettingsUpdate: (s: AppSettings) => void
  onClose:          () => void
  /** When true, renders without the fixed modal overlay — for embedding inside Settings */
  embedded?:        boolean
}

const isElectron = typeof window !== 'undefined' && !!window.api

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

interface ServerStatus {
  ready:   boolean
  tools:   number
  error:   string | null
  testing: boolean
}

type AddTab = 'stdio' | 'remote'

function formatExpiry(expiresAt?: number): string {
  if (!expiresAt) return 'Non-expiring'
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'Expired'
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (days > 0)  return `Expires in ${days}d ${hours % 24}h`
  if (hours > 0) return `Expires in ${hours}h ${mins % 60}m`
  return `Expires in ${mins}m`
}

// ── OAuth connect button ──────────────────────────────────────────────────────

function OAuthConnectButton({ server, onUpdate }: {
  server:   McpServerConfig
  onUpdate: (updated: McpServerConfig) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const token    = server.oauthToken
  const isValid  = token && (!token.expiresAt || token.expiresAt > Date.now() + 60_000)

  const handleConnect = async () => {
    if (!isElectron || !server.oauth) return
    setLoading(true); setError(null)
    try {
      const result = await window.api.startMcpOAuth(server.oauth)
      if (result.ok && result.token) onUpdate({ ...server, oauthToken: result.token })
      else setError(result.error ?? 'OAuth failed')
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const handleRefresh = async () => {
    if (!isElectron || !server.oauth || !token?.refreshToken) return
    setLoading(true); setError(null)
    try {
      const result = await window.api.refreshMcpToken({
        tokenUrl:     server.oauth.tokenUrl,
        clientId:     server.oauth.clientId,
        clientSecret: server.oauth.clientSecret,
        refreshToken: token.refreshToken,
      })
      if (result.ok && result.token) onUpdate({ ...server, oauthToken: result.token })
      else setError(result.error ?? 'Refresh failed')
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const handleRevoke = async () => {
    if (!isElectron) return
    await window.api.revokeMcpToken(server.oauth?.clientId ?? server.id)
    onUpdate({ ...server, oauthToken: undefined })
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {isValid ? (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Connected · {formatExpiry(token.expiresAt)}
          </span>
          {token.refreshToken && (
            <button onClick={handleRefresh} disabled={loading}
                    className="text-[10px] text-blue-500 hover:text-blue-600 disabled:opacity-40">
              Refresh
            </button>
          )}
          <button onClick={handleRevoke}
                  className="text-[10px] text-red-400 hover:text-red-500 ml-auto">
            Disconnect
          </button>
        </div>
      ) : (
        <button onClick={handleConnect} disabled={loading || !server.oauth}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium transition-colors">
          {loading ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Opening browser…
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Connect with OAuth
            </>
          )}
        </button>
      )}
      {error && <p className="text-[10px] text-red-500 dark:text-red-400 truncate">{error}</p>}
      {!server.oauth && (
        <p className="text-[10px] text-gray-400 dark:text-gray-600 italic">Configure OAuth settings below to enable connection.</p>
      )}
    </div>
  )
}

// ── Panel body (list + add form + footer) — shared between modal and embedded ─

interface BodyProps {
  settings:         AppSettings
  onSettingsUpdate: (s: AppSettings) => void
}

function PanelBody({ settings, onSettingsUpdate }: BodyProps) {
  const servers = settings.mcpServers ?? []

  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({})
  const [showAdd,  setShowAdd]  = useState(false)
  const [addTab,   setAddTab]   = useState<AddTab>('stdio')

  // stdio fields
  const [newName, setNewName] = useState('')
  const [newCmd,  setNewCmd]  = useState('')
  const [newArgs, setNewArgs] = useState('')
  const [newEnv,  setNewEnv]  = useState('')

  // remote fields
  const [remName,       setRemName]       = useState('')
  const [remUrl,        setRemUrl]        = useState('')
  const [remNoApproval, setRemNoApproval] = useState(false)
  const [showOAuth,     setShowOAuth]     = useState(false)
  const [oauthAuthUrl,  setOauthAuthUrl]  = useState('')
  const [oauthTokenUrl, setOauthTokenUrl] = useState('')
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthSecret,   setOauthSecret]   = useState('')
  const [oauthScopes,   setOauthScopes]   = useState('')

  const updateSettings = (mcpServers: McpServerConfig[]) => {
    onSettingsUpdate({ ...settings, mcpServers })
  }

  const updateServer = useCallback((updated: McpServerConfig) => {
    onSettingsUpdate({ ...settings, mcpServers: servers.map(s => s.id === updated.id ? updated : s) })
  }, [servers, settings, onSettingsUpdate])

  useEffect(() => {
    if (!isElectron || servers.length === 0) return
    window.api.listMcpServers(servers).then(list => {
      const map: Record<string, ServerStatus> = {}
      list.forEach(s => { map[s.id] = { ...s.status, testing: false } })
      setStatuses(map)
    }).catch(() => {})
  }, [])

  const handleTest = useCallback(async (config: McpServerConfig) => {
    if (!isElectron || config.serverType === 'remote') return
    setStatuses(prev => ({ ...prev, [config.id]: { ready: false, tools: 0, error: null, testing: true } }))
    const result = await window.api.testMcpServer(config)
    setStatuses(prev => ({
      ...prev,
      [config.id]: { ready: result.ok, tools: result.tools?.length ?? 0, error: result.error ?? null, testing: false }
    }))
  }, [])

  const handleStop = useCallback(async (id: string) => {
    if (!isElectron) return
    await window.api.stopMcpServer(id)
    setStatuses(prev => ({ ...prev, [id]: { ready: false, tools: 0, error: null, testing: false } }))
  }, [])

  const handleAddStdio = () => {
    if (!newName.trim() || !newCmd.trim()) return
    const envObj: Record<string, string> = {}
    newEnv.trim().split('\n').forEach(line => {
      const eq = line.indexOf('=')
      if (eq > 0) envObj[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    })
    updateSettings([...servers, {
      id: genId(), name: newName.trim(), serverType: 'stdio',
      command: newCmd.trim(),
      args:    newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined,
      env:     Object.keys(envObj).length > 0 ? envObj : undefined,
      enabled: true,
    }])
    setNewName(''); setNewCmd(''); setNewArgs(''); setNewEnv(''); setShowAdd(false)
  }

  const handleAddRemote = () => {
    if (!remName.trim() || !remUrl.trim()) return
    const oauthCfg: McpOAuthConfig | undefined =
      (showOAuth && oauthAuthUrl && oauthTokenUrl && oauthClientId) ? {
        authorizationUrl: oauthAuthUrl.trim(),
        tokenUrl:         oauthTokenUrl.trim(),
        clientId:         oauthClientId.trim(),
        clientSecret:     oauthSecret.trim() || undefined,
        scopes:           oauthScopes.trim() || 'read',
      } : undefined
    updateSettings([...servers, {
      id: genId(), name: remName.trim(), serverType: 'remote',
      serverUrl: remUrl.trim(), requireApproval: !remNoApproval, enabled: true, oauth: oauthCfg,
    }])
    setRemName(''); setRemUrl(''); setRemNoApproval(false)
    setShowOAuth(false); setOauthAuthUrl(''); setOauthTokenUrl('')
    setOauthClientId(''); setOauthSecret(''); setOauthScopes('')
    setShowAdd(false)
  }

  const handleDelete = (id: string) => {
    handleStop(id)
    updateSettings(servers.filter(s => s.id !== id))
  }

  const toggleEnabled = (id: string) => {
    updateSettings(servers.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))
  }

  const inp = 'w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400'

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Server list */}
      <div className="flex-1 overflow-y-auto">
        {servers.length === 0 && !showAdd ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
            <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">No MCP servers configured</p>
            <p className="text-xs text-center max-w-xs">Add a local stdio server or connect to a remote HTTP server with OAuth.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {servers.map(srv => {
              const st       = statuses[srv.id]
              const isRemote = srv.serverType === 'remote'
              const hasToken = isRemote && !!srv.oauthToken
              const tokenOk  = hasToken && (!srv.oauthToken!.expiresAt || srv.oauthToken!.expiresAt > Date.now() + 60_000)
              return (
                <div key={srv.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                        isRemote
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                          : 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400'
                      }`}>
                        {isRemote ? 'REMOTE' : 'LOCAL'}
                      </span>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isRemote
                          ? (tokenOk ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600')
                          : st?.testing ? 'bg-yellow-400 animate-pulse'
                          : st?.ready   ? 'bg-green-500'
                          : st?.error   ? 'bg-red-500'
                          : 'bg-gray-300 dark:bg-gray-600'
                      }`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{srv.name}</p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-600 font-mono truncate">
                          {isRemote ? (srv.serverUrl ?? '') : `${srv.command ?? ''}${srv.args ? ' ' + srv.args.join(' ') : ''}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {st?.ready && !isRemote && (
                        <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                          {st.tools} tool{st.tools !== 1 ? 's' : ''}
                        </span>
                      )}
                      {st?.error && !st.testing && !isRemote && (
                        <span className="text-[10px] text-red-500" title={st.error}>error</span>
                      )}
                      {/* enable toggle */}
                      <button onClick={() => toggleEnabled(srv.id)}
                              className={`w-8 h-4 rounded-full transition-colors relative ${srv.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${srv.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      {/* test/stop for local */}
                      {!isRemote && (
                        st?.ready ? (
                          <button onClick={() => handleStop(srv.id)}
                                  className="px-2 py-0.5 text-[10px] rounded text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                            Disconnect
                          </button>
                        ) : (
                          <button onClick={() => handleTest(srv)} disabled={st?.testing}
                                  className="px-2 py-0.5 text-[10px] rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 disabled:opacity-40 transition-colors">
                            {st?.testing ? 'Testing…' : 'Connect'}
                          </button>
                        )
                      )}
                      {/* delete */}
                      <button onClick={() => handleDelete(srv.id)}
                              className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* OAuth area for remote servers */}
                  {isRemote && <OAuthConnectButton server={srv} onUpdate={updateServer} />}
                  {st?.error && !isRemote && (
                    <p className="mt-1 text-[10px] text-red-500 dark:text-red-400 font-mono truncate">{st.error}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Add server form */}
        {showAdd && (
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
            {/* Tabs */}
            <div className="flex gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
              {(['stdio', 'remote'] as AddTab[]).map(tab => (
                <button key={tab} onClick={() => setAddTab(tab)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          addTab === tab
                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}>
                  {tab === 'stdio' ? '⚡ Local (stdio)' : '🌐 Remote (HTTP)'}
                </button>
              ))}
            </div>

            {addTab === 'stdio' ? (
              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Name</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="My server" className={inp} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Command</label>
                  <input value={newCmd} onChange={e => setNewCmd(e.target.value)} placeholder="npx @my-org/mcp-server" className={`${inp} font-mono text-xs`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Arguments (space-separated, optional)</label>
                  <input value={newArgs} onChange={e => setNewArgs(e.target.value)} placeholder="--port 3000" className={`${inp} font-mono text-xs`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Environment variables (KEY=VALUE, one per line)</label>
                  <textarea value={newEnv} onChange={e => setNewEnv(e.target.value)} placeholder="API_KEY=abc123" rows={2}
                            className={`${inp} font-mono text-xs resize-none`} />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddStdio} disabled={!newName.trim() || !newCmd.trim()}
                          className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                    Add Server
                  </button>
                  <button onClick={() => { setShowAdd(false); setNewName(''); setNewCmd(''); setNewArgs(''); setNewEnv('') }}
                          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Name</label>
                  <input value={remName} onChange={e => setRemName(e.target.value)} placeholder="ChatGPT Actions" className={inp} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Server URL</label>
                  <input value={remUrl} onChange={e => setRemUrl(e.target.value)} placeholder="https://api.example.com/mcp"
                         className={`${inp} font-mono text-xs`} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={remNoApproval} onChange={e => setRemNoApproval(e.target.checked)} className="rounded" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">Auto-approve all tool calls (no per-call confirmation)</span>
                </label>

                {/* OAuth toggle */}
                <div>
                  <button onClick={() => setShowOAuth(v => !v)}
                          className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-600 transition-colors">
                    <svg className={`w-3 h-3 transition-transform ${showOAuth ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    {showOAuth ? 'Hide' : 'Add'} OAuth 2.0 + PKCE settings
                  </button>

                  {showOAuth && (
                    <div className="mt-2.5 space-y-2 pl-3 border-l-2 border-blue-200 dark:border-blue-800">
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        The app uses <strong>Authorization Code + PKCE</strong> (RFC 8252) — no client secret needed for public clients.
                      </p>
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Authorization URL</label>
                        <input value={oauthAuthUrl} onChange={e => setOauthAuthUrl(e.target.value)}
                               placeholder="https://auth.example.com/oauth/authorize"
                               className={`${inp} text-xs font-mono`} />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Token URL</label>
                        <input value={oauthTokenUrl} onChange={e => setOauthTokenUrl(e.target.value)}
                               placeholder="https://auth.example.com/oauth/token"
                               className={`${inp} text-xs font-mono`} />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Client ID</label>
                        <input value={oauthClientId} onChange={e => setOauthClientId(e.target.value)}
                               placeholder="my-client-id" className={`${inp} text-xs font-mono`} />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                          Client Secret <span className="text-gray-400 font-normal">(optional)</span>
                        </label>
                        <input type="password" value={oauthSecret} onChange={e => setOauthSecret(e.target.value)}
                               placeholder="leave blank for public clients" className={`${inp} text-xs`} />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                          Scopes <span className="text-gray-400 font-normal">(space-separated)</span>
                        </label>
                        <input value={oauthScopes} onChange={e => setOauthScopes(e.target.value)}
                               placeholder="read write" className={`${inp} text-xs font-mono`} />
                      </div>
                    </div>
                  )}
                </div>

                {/* OpenAI note */}
                <div className="flex items-start gap-2 p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-[10px] text-blue-700 dark:text-blue-300">
                    Remote MCP servers are sent natively to <strong>OpenAI's Responses API</strong> —
                    connect with OAuth and the model calls them directly.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button onClick={handleAddRemote} disabled={!remName.trim() || !remUrl.trim()}
                          className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                    Add Remote Server
                  </button>
                  <button onClick={() => {
                    setShowAdd(false); setRemName(''); setRemUrl(''); setRemNoApproval(false)
                    setShowOAuth(false); setOauthAuthUrl(''); setOauthTokenUrl('')
                    setOauthClientId(''); setOauthSecret(''); setOauthScopes('')
                  }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer — add button */}
      {!showAdd && (
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <button onClick={() => setShowAdd(true)}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:border-purple-300 dark:hover:border-purple-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add MCP Server
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function McpServersPanel({ settings, onSettingsUpdate, onClose, embedded }: Props) {
  // ── Embedded mode: render inline inside Settings ──────────────────────────
  if (embedded) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Connect local (stdio) or remote (HTTP + OAuth) MCP servers to extend the AI with external tools.{' '}
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer"
               className="text-blue-500 hover:underline">modelcontextprotocol.io</a>
          </p>
        </div>
        <PanelBody settings={settings} onSettingsUpdate={onSettingsUpdate} />
      </div>
    )
  }

  // ── Modal mode ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700
                      w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">MCP Servers</h2>
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer"
               className="text-[10px] text-blue-500 hover:underline">modelcontextprotocol.io</a>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <PanelBody settings={settings} onSettingsUpdate={onSettingsUpdate} />
      </div>
    </div>
  )
}
