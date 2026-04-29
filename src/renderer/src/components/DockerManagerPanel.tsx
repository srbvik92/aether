/**
 * DockerManagerPanel — VS Code-style Docker management panel.
 *
 * Features:
 *  - Detects whether Docker is installed/running; shows install guide if not
 *  - Three tabs: Containers | Images | Volumes
 *  - Containers: list with status badge, start/stop/restart/remove actions
 *  - Container detail: CPU/memory stats, live log streaming, "Open Shell" button
 *  - "Ask AI" on any container sends its logs to the chat
 *  - Images: list with size, created date, remove action
 *  - Volumes: list with driver/mountpoint, remove action
 *  - Auto-refresh every 5 s
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { DockerContainer, DockerImage, DockerVolume, DockerStats } from '../../../shared/types'

interface Props {
  onClose:     () => void
  onAskAI:     (prompt: string) => void
  onOpenShell: (command: string) => void   // dispatches to terminal panel
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Statebadge({ state }: { state: string }) {
  const cfg: Record<string, string> = {
    running:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    exited:     'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    paused:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    created:    'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    restarting: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    dead:       'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  }
  const dot: Record<string, string> = {
    running: 'bg-emerald-500', exited: 'bg-gray-400', paused: 'bg-amber-500',
    created: 'bg-blue-500', restarting: 'bg-purple-500', dead: 'bg-red-500',
  }
  const cls = cfg[state] ?? cfg.exited
  const d   = dot[state] ?? dot.exited
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d} ${state === 'running' ? 'animate-pulse' : ''}`} />
      {state}
    </span>
  )
}

function IconBtn({ onClick, title, danger, children }: {
  onClick: () => void; title: string; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      title={title}
      className={`w-6 h-6 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
        danger
          ? 'text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DockerManagerPanel({ onClose, onAskAI, onOpenShell }: Props) {
  const [tab,        setTab]        = useState<'containers' | 'images' | 'volumes'>('containers')
  const [ready,      setReady]      = useState<boolean | null>(null)   // null = checking
  const [version,    setVersion]    = useState('')
  const [notInstalled, setNotInstalled] = useState(false)

  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [images,     setImages]     = useState<DockerImage[]>([])
  const [volumes,    setVolumes]    = useState<DockerVolume[]>([])
  const [loading,    setLoading]    = useState(false)
  const [filter,     setFilter]     = useState<'all' | 'running' | 'stopped'>('all')

  const [selected,   setSelected]   = useState<DockerContainer | null>(null)
  const [stats,      setStats]      = useState<DockerStats | null>(null)
  const [logs,       setLogs]       = useState<string>('')
  const [streaming,  setStreaming]  = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const logsEndRef   = useRef<HTMLDivElement>(null)
  const streamingRef = useRef(false)

  // ── Check Docker ───────────────────────────────────────────────────────────
  useEffect(() => {
    window.api.dockerCheck().then(res => {
      if (res.ok) { setReady(true); setVersion(res.version ?? '') }
      else        { setReady(false); setNotInstalled(true) }
    })
  }, [])

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      const [c, i, v] = await Promise.all([
        window.api.dockerListContainers(),
        window.api.dockerListImages(),
        window.api.dockerListVolumes(),
      ])
      if (c.ok) setContainers((c.containers ?? []) as DockerContainer[])
      if (i.ok) setImages((i.images ?? []) as DockerImage[])
      if (v.ok) setVolumes((v.volumes ?? []) as DockerVolume[])
    } finally {
      setLoading(false)
    }
  }, [ready])

  useEffect(() => { loadAll() }, [loadAll])

  // Auto-refresh every 5 s
  useEffect(() => {
    if (!ready) return
    const id = setInterval(loadAll, 5000)
    return () => clearInterval(id)
  }, [ready, loadAll])

  // ── Log streaming listener ─────────────────────────────────────────────────
  useEffect(() => {
    window.api.onDockerLogChunk(({ containerId, data }) => {
      if (!streamingRef.current) return
      if (selected && containerId !== selected.id) return
      setLogs(prev => (prev + data).slice(-50000))   // keep last 50 kB
    })
    return () => window.api.removeDockerLogListeners()
  }, [selected])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // ── Select container ───────────────────────────────────────────────────────
  const selectContainer = useCallback(async (c: DockerContainer) => {
    // Stop previous stream
    if (selected && streamingRef.current) {
      await window.api.dockerStopLogs(selected.id)
      streamingRef.current = false
      setStreaming(false)
    }
    setSelected(c)
    setLogs('')
    setStats(null)

    // Load static logs
    const logsRes = await window.api.dockerGetLogs(c.id, 200)
    if (logsRes.ok) setLogs(logsRes.logs ?? '')

    // Load stats if running
    if (c.state === 'running') {
      const statsRes = await window.api.dockerStats(c.id)
      if (statsRes.ok) setStats(statsRes.stats as DockerStats)
    }
  }, [selected])

  // ── Stream toggle ──────────────────────────────────────────────────────────
  const toggleStream = useCallback(async () => {
    if (!selected) return
    if (streaming) {
      await window.api.dockerStopLogs(selected.id)
      streamingRef.current = false
      setStreaming(false)
    } else {
      setLogs('')
      await window.api.dockerStreamLogs(selected.id)
      streamingRef.current = true
      setStreaming(true)
    }
  }, [selected, streaming])

  // ── Container action ───────────────────────────────────────────────────────
  const containerAction = useCallback(async (action: string, id: string) => {
    setActionBusy(id + action)
    try {
      await window.api.dockerContainerAction(action, id)
      await loadAll()
      // Refresh selected container state
      if (selected?.id === id) {
        setSelected(prev => {
          if (!prev) return null
          const updated = containers.find(c => c.id === id)
          return updated ?? prev
        })
      }
    } finally {
      setActionBusy(null)
    }
  }, [loadAll, selected, containers])

  // ── Ask AI ─────────────────────────────────────────────────────────────────
  const askAI = useCallback(() => {
    if (!selected) return
    onAskAI(
      `I have a Docker container **${selected.name}** (image: \`${selected.image}\`) ` +
      `in state **${selected.state}** (${selected.status}).\n\n` +
      `Here are the recent logs:\n\`\`\`\n${logs.slice(-4000)}\n\`\`\`\n\n` +
      `Please help me understand what's happening and suggest fixes if needed.`
    )
  }, [selected, logs, onAskAI])

  // ── Filtered containers ────────────────────────────────────────────────────
  const visibleContainers = containers.filter(c => {
    if (filter === 'running') return c.state === 'running'
    if (filter === 'stopped') return c.state !== 'running'
    return true
  })

  // ── Not installed banner ───────────────────────────────────────────────────
  if (ready === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-8 flex items-center gap-3 text-gray-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
          </svg>
          Checking Docker…
        </div>
      </div>
    )
  }

  if (notInstalled) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-8 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl">🐳</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Docker not available</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Docker Desktop must be installed and running</p>
            </div>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 mb-4 space-y-1">
            <p className="font-medium">To enable the Docker Manager:</p>
            <ol className="list-decimal list-inside space-y-1 mt-1">
              <li>Install <a href="https://www.docker.com/products/docker-desktop" className="underline">Docker Desktop</a></li>
              <li>Launch Docker Desktop and wait for it to start</li>
              <li>Re-open this panel</li>
            </ol>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-600 font-mono bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5 mb-4">
            # verify installation<br />
            docker version
          </div>
          <button onClick={onClose} className="w-full py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            Close
          </button>
        </div>
      </div>
    )
  }

  // ── Main panel ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="m-auto w-full max-w-6xl h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700"
        onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <span className="text-xl">🐳</span>
          <span className="font-semibold text-gray-800 dark:text-gray-200 text-sm">Docker Manager</span>
          {version && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 font-mono">
              v{version}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={loadAll}
            title="Refresh"
            className={`w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${loading ? 'animate-spin' : ''}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 flex-shrink-0">
          {(['containers', 'images', 'volumes'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                tab === t
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200 dark:border-gray-700'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-gray-800/60'
              }`}
            >
              {t === 'containers' && `🗂 Containers (${containers.length})`}
              {t === 'images'     && `📦 Images (${images.length})`}
              {t === 'volumes'    && `💾 Volumes (${volumes.length})`}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* ════ CONTAINERS TAB ════ */}
          {tab === 'containers' && (
            <>
              {/* Left: list */}
              <div className="w-[55%] flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Filter */}
                <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                  {(['all', 'running', 'stopped'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors capitalize ${
                        filter === f
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                      }`}
                    >{f}</button>
                  ))}
                  <span className="ml-auto text-[10px] text-gray-400">
                    {visibleContainers.filter(c => c.state === 'running').length} running
                  </span>
                </div>

                {/* Container rows */}
                <div className="flex-1 overflow-y-auto">
                  {visibleContainers.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                      <span className="text-3xl opacity-30">🗂</span>
                      <span className="text-xs">No containers</span>
                    </div>
                  )}
                  {visibleContainers.map(c => (
                    <div key={c.id}
                      onClick={() => selectContainer(c)}
                      className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors ${
                        selected?.id === c.id
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <Statebadge state={c.state} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{c.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{c.image}</p>
                        {c.ports && <p className="text-[10px] text-blue-500 dark:text-blue-400 truncate font-mono">{c.ports.split(',')[0]}</p>}
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 hidden md:block">{c.runningFor}</span>
                      {/* Quick actions */}
                      <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        {c.state !== 'running' ? (
                          <IconBtn onClick={() => containerAction('start', c.id)} title="Start">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                            </svg>
                          </IconBtn>
                        ) : (
                          <IconBtn onClick={() => containerAction('stop', c.id)} title="Stop">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                            </svg>
                          </IconBtn>
                        )}
                        <IconBtn onClick={() => containerAction('restart', c.id)} title="Restart">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                        </IconBtn>
                        <IconBtn danger onClick={() => { if (confirm(`Remove container "${c.name}"?`)) containerAction('remove', c.id) }} title="Remove">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </IconBtn>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: detail */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {!selected ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
                    <span className="text-5xl opacity-20">🐳</span>
                    <p className="text-xs">Select a container to see details</p>
                  </div>
                ) : (
                  <>
                    {/* Detail header */}
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Statebadge state={selected.state} />
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{selected.name}</span>
                        <span className="text-xs text-gray-400 font-mono">{selected.id.slice(0, 12)}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{selected.image} · {selected.status}</p>
                      {selected.ports && (
                        <p className="text-[11px] text-blue-500 dark:text-blue-400 font-mono mt-0.5">{selected.ports}</p>
                      )}
                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {selected.state === 'running' && (
                          <button
                            onClick={() => onOpenShell(`docker exec -it ${selected.id} sh`)}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Open Shell
                          </button>
                        )}
                        <button
                          onClick={askAI}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 border border-blue-200 dark:border-blue-800 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          Ask AI
                        </button>
                      </div>
                    </div>

                    {/* Stats bar */}
                    {stats && (
                      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                        {[
                          { label: 'CPU', value: stats.cpuPct },
                          { label: 'MEM', value: `${stats.memUsage} (${stats.memPct})` },
                          { label: 'NET I/O', value: stats.netIO },
                          { label: 'BLOCK I/O', value: stats.blockIO },
                          { label: 'PIDs', value: stats.pids },
                        ].map(s => (
                          <div key={s.label} className="flex flex-col min-w-0">
                            <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">{s.label}</span>
                            <span className="text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate">{s.value}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Log viewer */}
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex-1">Logs</span>
                      <button
                        onClick={toggleStream}
                        className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                          streaming
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                            : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        {streaming ? (
                          <><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Stop stream</>
                        ) : (
                          <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live stream</>
                        )}
                      </button>
                      <button
                        onClick={() => setLogs('')}
                        className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto bg-gray-950 dark:bg-gray-950 p-3 font-mono text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap break-all">
                      {logs || <span className="text-gray-600">No logs yet…</span>}
                      <div ref={logsEndRef} />
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* ════ IMAGES TAB ════ */}
          {tab === 'images' && (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    {['Repository', 'Tag', 'Image ID', 'Size', 'Created', ''].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {images.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-12 text-gray-400">No images found</td></tr>
                  )}
                  {images.map(img => (
                    <tr key={img.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200 truncate max-w-[200px]">{img.repository}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-mono text-[10px]">{img.tag}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-400 text-[10px]">{img.id.slice(0, 12)}</td>
                      <td className="px-3 py-2 text-gray-500">{img.size}</td>
                      <td className="px-3 py-2 text-gray-400">{img.createdAt}</td>
                      <td className="px-3 py-2">
                        <IconBtn danger onClick={() => { if (confirm(`Remove image ${img.repository}:${img.tag}?`)) window.api.dockerImageAction('remove', img.id).then(loadAll) }} title="Remove image">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </IconBtn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ════ VOLUMES TAB ════ */}
          {tab === 'volumes' && (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    {['Name', 'Driver', 'Mount Point', ''].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {volumes.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-12 text-gray-400">No volumes found</td></tr>
                  )}
                  {volumes.map(vol => (
                    <tr key={vol.name} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200 truncate max-w-[200px]">{vol.name}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] font-mono">{vol.driver}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-[10px] truncate max-w-[300px]">{vol.mountpoint || '—'}</td>
                      <td className="px-3 py-2">
                        <IconBtn danger onClick={() => { if (confirm(`Remove volume "${vol.name}"?`)) window.api.dockerVolumeAction('remove', vol.name).then(loadAll) }} title="Remove volume">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </IconBtn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
