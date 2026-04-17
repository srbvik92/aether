import { useState, useEffect, useCallback } from 'react'
import { McpServerConfig, McpTool, AppSettings } from '../../../shared/types'

interface Props {
  settings:        AppSettings
  onSettingsUpdate: (s: AppSettings) => void
  onClose:         () => void
}

const isElectron = typeof window !== 'undefined' && !!window.api

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

interface ServerStatus {
  ready:  boolean
  tools:  number
  error:  string | null
  testing: boolean
}

export default function McpServersPanel({ settings, onSettingsUpdate, onClose }: Props) {
  const servers = settings.mcpServers ?? []

  const [statuses,  setStatuses]  = useState<Record<string, ServerStatus>>({})
  const [showAdd,   setShowAdd]   = useState(false)
  const [newCmd,    setNewCmd]    = useState('')
  const [newArgs,   setNewArgs]   = useState('')
  const [newName,   setNewName]   = useState('')
  const [newEnv,    setNewEnv]    = useState('')   // KEY=VALUE per line

  const updateSettings = (mcpServers: McpServerConfig[]) => {
    onSettingsUpdate({ ...settings, mcpServers })
  }

  // Refresh server statuses on mount
  useEffect(() => {
    if (!isElectron || servers.length === 0) return
    window.api.listMcpServers(servers).then(list => {
      const map: Record<string, ServerStatus> = {}
      list.forEach(s => { map[s.id] = { ...s.status, testing: false } })
      setStatuses(map)
    }).catch(() => {})
  }, [])

  const handleTest = useCallback(async (config: McpServerConfig) => {
    if (!isElectron) return
    setStatuses(prev => ({ ...prev, [config.id]: { ready: false, tools: 0, error: null, testing: true } }))
    const result = await window.api.testMcpServer(config)
    setStatuses(prev => ({
      ...prev,
      [config.id]: {
        ready:   result.ok,
        tools:   result.tools?.length ?? 0,
        error:   result.error ?? null,
        testing: false
      }
    }))
  }, [])

  const handleStop = useCallback(async (id: string) => {
    if (!isElectron) return
    await window.api.stopMcpServer(id)
    setStatuses(prev => ({ ...prev, [id]: { ready: false, tools: 0, error: null, testing: false } }))
  }, [])

  const handleAdd = () => {
    if (!newName.trim() || !newCmd.trim()) return
    const envObj: Record<string, string> = {}
    newEnv.trim().split('\n').forEach(line => {
      const eq = line.indexOf('=')
      if (eq > 0) envObj[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    })
    const newServer: McpServerConfig = {
      id:      genId(),
      name:    newName.trim(),
      command: newCmd.trim(),
      args:    newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined,
      env:     Object.keys(envObj).length > 0 ? envObj : undefined,
      enabled: true
    }
    updateSettings([...servers, newServer])
    setNewName(''); setNewCmd(''); setNewArgs(''); setNewEnv(''); setShowAdd(false)
  }

  const handleDelete = (id: string) => {
    handleStop(id)
    updateSettings(servers.filter(s => s.id !== id))
  }

  const toggleEnabled = (id: string) => {
    updateSettings(servers.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))
  }

  const inputCls = 'w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700
                      w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Server list */}
          {servers.length === 0 && !showAdd ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
              <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">No MCP servers configured</p>
              <p className="text-xs text-center max-w-xs">MCP servers extend the AI with external tools — filesystem, databases, APIs, and more.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {servers.map(srv => {
                const st = statuses[srv.id]
                return (
                  <div key={srv.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Status dot */}
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          st?.testing ? 'bg-yellow-400 animate-pulse' :
                          st?.ready   ? 'bg-green-500' :
                          st?.error   ? 'bg-red-500' :
                          'bg-gray-300 dark:bg-gray-600'
                        }`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{srv.name}</p>
                          <p className="text-[10px] text-gray-400 dark:text-gray-600 font-mono truncate">
                            {srv.command}{srv.args ? ' ' + srv.args.join(' ') : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {st?.ready && (
                          <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                            {st.tools} tool{st.tools !== 1 ? 's' : ''}
                          </span>
                        )}
                        {st?.error && !st.testing && (
                          <span className="text-[10px] text-red-500" title={st.error}>error</span>
                        )}

                        {/* Enable toggle */}
                        <button
                          onClick={() => toggleEnabled(srv.id)}
                          className={`w-8 h-4 rounded-full transition-colors relative ${srv.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                          title={srv.enabled ? 'Enabled' : 'Disabled'}
                        >
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${srv.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>

                        {/* Test / Stop */}
                        {st?.ready ? (
                          <button onClick={() => handleStop(srv.id)}
                                  className="px-2 py-0.5 text-[10px] rounded text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                            Disconnect
                          </button>
                        ) : (
                          <button onClick={() => handleTest(srv)}
                                  disabled={st?.testing}
                                  className="px-2 py-0.5 text-[10px] rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-800 disabled:opacity-40 transition-colors">
                            {st?.testing ? 'Testing…' : 'Connect'}
                          </button>
                        )}

                        {/* Delete */}
                        <button onClick={() => handleDelete(srv.id)}
                                className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 transition-colors">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Expanded tools list */}
                    {st?.ready && statuses[srv.id]?.tools > 0 && (
                      <ToolsList serverId={srv.id} />
                    )}

                    {st?.error && (
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
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">Add MCP Server</p>
              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Name</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="My server" className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Command</label>
                  <input value={newCmd} onChange={e => setNewCmd(e.target.value)} placeholder="npx @my-org/mcp-server" className={`${inputCls} font-mono text-xs`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Arguments (space-separated, optional)</label>
                  <input value={newArgs} onChange={e => setNewArgs(e.target.value)} placeholder="--port 3000" className={`${inputCls} font-mono text-xs`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Environment variables (KEY=VALUE, one per line)</label>
                  <textarea value={newEnv} onChange={e => setNewEnv(e.target.value)} placeholder="API_KEY=abc123" rows={2}
                            className={`${inputCls} font-mono text-xs resize-none`} />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAdd} disabled={!newName.trim() || !newCmd.trim()}
                          className="flex-1 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                    Add Server
                  </button>
                  <button onClick={() => { setShowAdd(false); setNewName(''); setNewCmd(''); setNewArgs(''); setNewEnv('') }}
                          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!showAdd && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
            <button
              onClick={() => setShowAdd(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:border-purple-300 dark:hover:border-purple-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add MCP Server
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-component: tool list (lazily fetched when a server connects) ──────────

function ToolsList({ serverId }: { serverId: string }) {
  const [tools, setTools] = useState<McpTool[]>([])

  useEffect(() => {
    if (!isElectron) return
    window.api.listMcpServers([]).then(list => {
      const srv = list.find(s => s.id === serverId)
      // Tools are not directly accessible here — just show the count from status
    }).catch(() => {})
  }, [serverId])

  return null  // Tools count is shown in the parent; full list is a future enhancement
}
