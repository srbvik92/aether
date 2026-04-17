import { useState, useEffect, useCallback } from 'react'
import { AppSettings, JiraProject, JiraIssue, LinearIssue } from '../../../shared/types'

interface Props {
  settings: AppSettings
  onClose: () => void
}

function PriorityBadge({ priority, isLinear = false }: { priority: string | number; isLinear?: boolean }) {
  if (isLinear) {
    const p = Number(priority)
    const label = p === 0 ? 'No priority' : p === 1 ? 'Urgent' : p === 2 ? 'High' : p === 3 ? 'Medium' : 'Low'
    const colors = p === 1 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
      : p === 2 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
      : p === 3 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
    return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors}`}>{label}</span>
  }
  const s = String(priority).toLowerCase()
  const colors = s === 'highest' || s === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    : s === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
    : s === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors}`}>{priority}</span>
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  const colors = s.includes('done') || s.includes('closed') || s.includes('completed')
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    : s.includes('progress') || s.includes('review') || s.includes('started')
    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors}`}>{status}</span>
}

// ── Jira Tab ──────────────────────────────────────────────────────────────────
function JiraTab({ settings }: { settings: AppSettings }) {
  const [projects, setProjects]   = useState<JiraProject[]>([])
  const [issues, setIssues]       = useState<JiraIssue[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [creating, setCreating]   = useState(false)
  const [form, setForm]           = useState({ summary: '', description: '', issueType: 'Task' })
  const [success, setSuccess]     = useState('')

  const jiraUrl   = settings.jiraUrl?.replace(/\/$/, '') ?? ''
  const jiraEmail = settings.jiraEmail ?? ''
  const jiraToken = settings.jiraToken ?? ''
  const configured = !!(jiraUrl && jiraEmail && jiraToken)

  const loadProjects = useCallback(async () => {
    if (!configured) return
    setLoading(true); setError('')
    const r = await window.api.jiraListProjects(jiraUrl, jiraEmail, jiraToken)
    setLoading(false)
    if (r.ok && r.projects) { setProjects(r.projects); if (r.projects.length > 0 && !selectedKey) setSelectedKey(r.projects[0].key) }
    else setError(r.error ?? 'Failed to load projects')
  }, [configured, jiraUrl, jiraEmail, jiraToken, selectedKey])

  const loadIssues = useCallback(async () => {
    if (!selectedKey || !configured) return
    setLoading(true); setError('')
    const r = await window.api.jiraListIssues(jiraUrl, jiraEmail, jiraToken, selectedKey)
    setLoading(false)
    if (r.ok && r.issues) setIssues(r.issues)
    else setError(r.error ?? 'Failed to load issues')
  }, [selectedKey, configured, jiraUrl, jiraEmail, jiraToken])

  useEffect(() => { loadProjects() }, [loadProjects])
  useEffect(() => { if (selectedKey) loadIssues() }, [selectedKey, loadIssues])

  const handleCreate = async () => {
    if (!form.summary.trim() || !selectedKey) return
    setLoading(true); setError(''); setSuccess('')
    const r = await window.api.jiraCreateIssue(jiraUrl, jiraEmail, jiraToken, { projectKey: selectedKey, summary: form.summary, description: form.description, issueType: form.issueType })
    setLoading(false)
    if (r.ok) {
      setSuccess(`Created ${r.key}`)
      setForm({ summary: '', description: '', issueType: 'Task' })
      setCreating(false)
      loadIssues()
    } else {
      setError(r.error ?? 'Create failed')
    }
  }

  if (!configured) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">Jira not configured.</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">Add Jira URL, email and API token in Settings → Integrations.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Project selector */}
      <div className="flex items-center gap-2">
        <select
          value={selectedKey}
          onChange={e => setSelectedKey(e.target.value)}
          className="flex-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {projects.map(p => (
            <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
          ))}
        </select>
        <button onClick={loadIssues} disabled={loading}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50 transition-colors">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button onClick={() => setCreating(c => !c)}
          className="px-3 py-1.5 text-xs rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors">
          + New
        </button>
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
      {success && <p className="text-xs text-green-600 dark:text-green-400">{success}</p>}

      {/* Create form */}
      {creating && (
        <div className="flex flex-col gap-2 p-3 rounded-xl border border-dashed border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10">
          <input placeholder="Summary *" value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800 dark:text-gray-200" />
          <textarea placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800 dark:text-gray-200 resize-none" />
          <div className="flex items-center gap-2">
            <select value={form.issueType} onChange={e => setForm(f => ({ ...f, issueType: e.target.value }))}
              className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option>Task</option><option>Bug</option><option>Story</option><option>Epic</option>
            </select>
            <button onClick={handleCreate} disabled={loading || !form.summary.trim()}
              className="px-3 py-1 text-xs rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors">
              Create
            </button>
            <button onClick={() => setCreating(false)}
              className="px-3 py-1 text-xs rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Issues list */}
      <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
        {issues.length === 0 && !loading && (
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center py-6">No issues found</p>
        )}
        {issues.map(issue => (
          <a key={issue.id} href={issue.url} target="_blank" rel="noreferrer"
            className="flex items-start gap-2 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors group">
            <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 group-hover:underline">{issue.key}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-800 dark:text-gray-200 truncate">{issue.summary}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <StatusBadge status={issue.status} />
                <PriorityBadge priority={issue.priority} />
                {issue.assignee && <span className="text-[10px] text-gray-400 dark:text-gray-600">→ {issue.assignee}</span>}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Linear Tab ────────────────────────────────────────────────────────────────
function LinearTab({ settings }: { settings: AppSettings }) {
  const [issues, setIssues]   = useState<LinearIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm]       = useState({ title: '', description: '', teamId: '', priority: '0' })
  const [success, setSuccess] = useState('')

  const token = settings.linearToken ?? ''
  const configured = !!token

  const loadIssues = useCallback(async () => {
    if (!configured) return
    setLoading(true); setError('')
    const r = await window.api.linearListIssues(token)
    setLoading(false)
    if (r.ok && r.issues) setIssues(r.issues)
    else setError(r.error ?? 'Failed to load issues')
  }, [configured, token])

  useEffect(() => { loadIssues() }, [loadIssues])

  const handleCreate = async () => {
    if (!form.title.trim() || !form.teamId.trim()) return
    setLoading(true); setError(''); setSuccess('')
    const r = await window.api.linearCreateIssue(token, { teamId: form.teamId, title: form.title, description: form.description, priority: Number(form.priority) })
    setLoading(false)
    if (r.ok) {
      setSuccess(`Created ${r.identifier}`)
      setForm({ title: '', description: '', teamId: form.teamId, priority: '0' })
      setCreating(false)
      loadIssues()
    } else {
      setError(r.error ?? 'Create failed')
    }
  }

  if (!configured) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">Linear not configured.</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">Add a Linear API token in Settings → Integrations.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">{issues.length} issue{issues.length !== 1 ? 's' : ''}</p>
        <div className="flex gap-2">
          <button onClick={loadIssues} disabled={loading}
            className="px-3 py-1.5 text-xs rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 disabled:opacity-50 transition-colors">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={() => setCreating(c => !c)}
            className="px-3 py-1.5 text-xs rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors">
            + New
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
      {success && <p className="text-xs text-green-600 dark:text-green-400">{success}</p>}

      {creating && (
        <div className="flex flex-col gap-2 p-3 rounded-xl border border-dashed border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10">
          <input placeholder="Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800 dark:text-gray-200" />
          <input placeholder="Team ID *" value={form.teamId} onChange={e => setForm(f => ({ ...f, teamId: e.target.value }))}
            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800 dark:text-gray-200" />
          <textarea placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={2}
            className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-800 dark:text-gray-200 resize-none" />
          <div className="flex items-center gap-2">
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              className="text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="0">No priority</option>
              <option value="1">Urgent</option>
              <option value="2">High</option>
              <option value="3">Medium</option>
              <option value="4">Low</option>
            </select>
            <button onClick={handleCreate} disabled={loading || !form.title.trim() || !form.teamId.trim()}
              className="px-3 py-1 text-xs rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors">
              Create
            </button>
            <button onClick={() => setCreating(false)}
              className="px-3 py-1 text-xs rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
        {issues.length === 0 && !loading && (
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center py-6">No issues found</p>
        )}
        {issues.map(issue => (
          <a key={issue.id} href={issue.url} target="_blank" rel="noreferrer"
            className="flex items-start gap-2 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-purple-200 dark:hover:border-purple-800 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors group">
            <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 shrink-0 mt-0.5 group-hover:underline">{issue.identifier}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-800 dark:text-gray-200 truncate">{issue.title}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <StatusBadge status={issue.state} />
                <PriorityBadge priority={issue.priority} isLinear />
                {issue.assignee && <span className="text-[10px] text-gray-400 dark:text-gray-600">→ {issue.assignee}</span>}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function JiraLinearPanel({ settings, onClose }: Props) {
  const [tab, setTab] = useState<'jira' | 'linear'>('jira')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700 max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Issues</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800">
          {(['jira', 'linear'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                tab === t
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}>
              {t === 'jira' ? '🔵 Jira' : '🟣 Linear'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'jira'   && <JiraTab   settings={settings} />}
          {tab === 'linear' && <LinearTab settings={settings} />}
        </div>
      </div>
    </div>
  )
}
