/**
 * GitHub / GitLab integration panel.
 *
 * Lets users view and create Pull Requests and Issues from within the chat app.
 * Requires a GitHub Personal Access Token stored in localStorage under the key
 * `github-pat`.  The repository owner/repo are auto-detected via
 * `window.api.githubDetectRepo(workspacePath)`; if detection fails the user can
 * enter them manually.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const isElectron = typeof window !== 'undefined' && !!window.api

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface GitHubPR {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  author: string
  branch: string
  url: string
  createdAt: string
  body?: string
}

interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  author: string
  labels: string[]
  url: string
  createdAt: string
  body?: string
}

interface GitHubCreatePRParams {
  owner: string
  repo: string
  title: string
  body: string
  head: string
  base: string
}

interface GitHubCreateIssueParams {
  owner: string
  repo: string
  title: string
  body: string
  labels?: string[]
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface Props {
  workspacePath: string
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Tab = 'prs' | 'issues' | 'create-pr' | 'create-issue'

function StateBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    open:   'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    merged: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
    closed: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${styles[state] ?? styles.closed}`}>
      {state}
    </span>
  )
}

function LabelPill({ label }: { label: string }) {
  // Deterministically pick a hue from the label text so labels keep their colour
  const hue = [...label].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: `hsl(${hue} 60% 88%)`, color: `hsl(${hue} 50% 30%)` }}
    >
      {label}
    </span>
  )
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3 inline-block ml-1 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Token notice banner
// ---------------------------------------------------------------------------

function TokenBanner({
  token,
  onChange,
}: {
  token: string
  onChange: (t: string) => void
}) {
  const [draft, setDraft] = useState(token)
  const [visible, setVisible] = useState(false)

  return (
    <div className="px-5 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700/40 flex-shrink-0">
      <p className="text-xs text-amber-800 dark:text-amber-300 font-medium mb-1.5">
        Enter a GitHub Personal Access Token to use this feature.{' '}
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-amber-600 dark:hover:text-amber-200"
        >
          Create one here
          <ExternalLinkIcon />
        </a>
      </p>
      <div className="flex gap-2">
        <input
          type={visible ? 'text' : 'password'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="ghp_…"
          className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-600 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={() => setVisible(v => !v)}
          className="px-2 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-600 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          title={visible ? 'Hide token' : 'Show token'}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
        <button
          onClick={() => { onChange(draft.trim()); localStorage.setItem('github-pat', draft.trim()) }}
          disabled={!draft.trim()}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Manual repo input form
// ---------------------------------------------------------------------------

function RepoForm({
  owner,
  repo,
  onSave,
}: {
  owner: string
  repo: string
  onSave: (owner: string, repo: string) => void
}) {
  const [draftOwner, setDraftOwner] = useState(owner)
  const [draftRepo, setDraftRepo] = useState(repo)

  return (
    <div className="flex flex-col items-center justify-center py-10 px-8 gap-4">
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-xs">
        Could not auto-detect the repository from the workspace. Enter the GitHub owner and repository name manually.
      </p>
      <div className="w-full max-w-xs flex flex-col gap-2">
        <input
          value={draftOwner}
          onChange={e => setDraftOwner(e.target.value)}
          placeholder="Owner (e.g. octocat)"
          className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={draftRepo}
          onChange={e => setDraftRepo(e.target.value)}
          placeholder="Repository (e.g. Hello-World)"
          className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => { if (draftOwner.trim() && draftRepo.trim()) onSave(draftOwner.trim(), draftRepo.trim()) }}
          disabled={!draftOwner.trim() || !draftRepo.trim()}
          className="mt-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          Connect
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pull Requests tab
// ---------------------------------------------------------------------------

function PRsTab({ owner, repo, token }: { owner: string; repo: string; token: string }) {
  const [prs, setPRs] = useState<GitHubPR[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isElectron || !token) return
    setLoading(true)
    setError(null)
    window.api
      .githubListPRs(owner, repo, token)
      .then(data => { setPRs(data); setLoading(false) })
      .catch(e => { setError(String(e?.message ?? e)); setLoading(false) })
  }, [owner, repo, token])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-14 text-gray-400 text-sm">
        <Spinner />
        <span>Loading pull requests…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center px-6 gap-2">
        <p className="text-sm text-red-500 font-medium">Failed to load pull requests</p>
        <p className="text-xs text-gray-400">{error}</p>
      </div>
    )
  }

  if (prs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center px-6">
        <span className="text-3xl mb-2">🔀</span>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No pull requests found</p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">There are no open or recent PRs for this repository.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {prs.map(pr => (
        <div key={pr.number} className="px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
          <div className="flex items-start gap-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <StateBadge state={pr.state} />
                <span className="text-xs font-mono text-gray-400 dark:text-gray-500">#{pr.number}</span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{pr.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-gray-400 dark:text-gray-500">
                <span>
                  <span className="font-medium text-gray-600 dark:text-gray-300">{pr.author}</span>
                  {' · '}
                  <span className="font-mono">{pr.branch}</span>
                </span>
                <span>{new Date(pr.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0 text-xs text-blue-500 hover:text-blue-400 font-medium whitespace-nowrap"
            >
              Open
              <ExternalLinkIcon />
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Issues tab
// ---------------------------------------------------------------------------

function IssuesTab({ owner, repo, token }: { owner: string; repo: string; token: string }) {
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isElectron || !token) return
    setLoading(true)
    setError(null)
    window.api
      .githubListIssues(owner, repo, token)
      .then(data => { setIssues(data); setLoading(false) })
      .catch(e => { setError(String(e?.message ?? e)); setLoading(false) })
  }, [owner, repo, token])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-14 text-gray-400 text-sm">
        <Spinner />
        <span>Loading issues…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center px-6 gap-2">
        <p className="text-sm text-red-500 font-medium">Failed to load issues</p>
        <p className="text-xs text-gray-400">{error}</p>
      </div>
    )
  }

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center px-6">
        <span className="text-3xl mb-2">🐛</span>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No issues found</p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">There are no open or recent issues for this repository.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {issues.map(issue => (
        <div key={issue.number} className="px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
          <div className="flex items-start gap-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <StateBadge state={issue.state} />
                <span className="text-xs font-mono text-gray-400 dark:text-gray-500">#{issue.number}</span>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{issue.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-gray-400 dark:text-gray-500">
                <span>
                  <span className="font-medium text-gray-600 dark:text-gray-300">{issue.author}</span>
                  {' · '}
                  {new Date(issue.createdAt).toLocaleDateString()}
                </span>
                {issue.labels.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {issue.labels.map(l => <LabelPill key={l} label={l} />)}
                  </div>
                )}
              </div>
            </div>
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0 text-xs text-blue-500 hover:text-blue-400 font-medium whitespace-nowrap"
            >
              Open
              <ExternalLinkIcon />
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create PR tab
// ---------------------------------------------------------------------------

function CreatePRTab({
  owner,
  repo,
  token,
  defaultBranch,
}: {
  owner: string
  repo: string
  token: string
  defaultBranch: string
}) {
  const [title, setTitle] = useState('')
  const [base, setBase] = useState(defaultBranch || 'main')
  const [head, setHead] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; url?: string; error?: string } | null>(null)

  const handleSubmit = useCallback(async () => {
    if (!isElectron || !title.trim() || !head.trim()) return
    setSubmitting(true)
    setResult(null)
    const params: GitHubCreatePRParams = { owner, repo, title: title.trim(), body, head: head.trim(), base: base.trim() || 'main' }
    const res = await window.api.githubCreatePR(params, token)
    setResult(res)
    setSubmitting(false)
    if (res.ok) { setTitle(''); setHead(''); setBody('') }
  }, [owner, repo, token, title, base, head, body])

  return (
    <div className="px-5 py-4 flex flex-col gap-3">
      {result && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${result.ok ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700/40' : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700/40'}`}>
          {result.ok ? (
            <>
              Pull request created!{' '}
              {result.url && (
                <a href={result.url} target="_blank" rel="noreferrer" className="underline hover:opacity-75">
                  View on GitHub
                  <ExternalLinkIcon />
                </a>
              )}
            </>
          ) : (
            <>Failed: {result.error ?? 'Unknown error'}</>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Title <span className="text-red-400">*</span></label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="My awesome feature"
          className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Base branch</label>
          <input
            value={base}
            onChange={e => setBase(e.target.value)}
            placeholder="main"
            className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Head branch <span className="text-red-400">*</span></label>
          <input
            value={head}
            onChange={e => setHead(e.target.value)}
            placeholder="feature/my-feature"
            className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Description</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={5}
          placeholder="Describe your changes…"
          className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || !title.trim() || !head.trim()}
        className="self-end px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
      >
        {submitting && <Spinner />}
        {submitting ? 'Creating…' : 'Create Pull Request'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create Issue tab
// ---------------------------------------------------------------------------

function CreateIssueTab({ owner, repo, token }: { owner: string; repo: string; token: string }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [labelsRaw, setLabelsRaw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; url?: string; error?: string } | null>(null)

  const handleSubmit = useCallback(async () => {
    if (!isElectron || !title.trim()) return
    setSubmitting(true)
    setResult(null)
    const labels = labelsRaw
      .split(',')
      .map(l => l.trim())
      .filter(Boolean)
    const params: GitHubCreateIssueParams = { owner, repo, title: title.trim(), body, ...(labels.length > 0 ? { labels } : {}) }
    const res = await window.api.githubCreateIssue(params, token)
    setResult(res)
    setSubmitting(false)
    if (res.ok) { setTitle(''); setBody(''); setLabelsRaw('') }
  }, [owner, repo, token, title, body, labelsRaw])

  return (
    <div className="px-5 py-4 flex flex-col gap-3">
      {result && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${result.ok ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700/40' : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700/40'}`}>
          {result.ok ? (
            <>
              Issue created!{' '}
              {result.url && (
                <a href={result.url} target="_blank" rel="noreferrer" className="underline hover:opacity-75">
                  View on GitHub
                  <ExternalLinkIcon />
                </a>
              )}
            </>
          ) : (
            <>Failed: {result.error ?? 'Unknown error'}</>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Title <span className="text-red-400">*</span></label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Something isn't working"
          className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Description</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={5}
          placeholder="Describe the issue in detail…"
          className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Labels <span className="text-gray-400 font-normal">(comma-separated)</span></label>
        <input
          value={labelsRaw}
          onChange={e => setLabelsRaw(e.target.value)}
          placeholder="bug, help wanted, question"
          className="px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />
        {labelsRaw.trim() && (
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            {labelsRaw.split(',').map(l => l.trim()).filter(Boolean).map(l => (
              <LabelPill key={l} label={l} />
            ))}
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || !title.trim()}
        className="self-end px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
      >
        {submitting && <Spinner />}
        {submitting ? 'Creating…' : 'Create Issue'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function GitHubPanel({ workspacePath, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('prs')
  const [token, setToken] = useState<string>(() => localStorage.getItem('github-pat') ?? '')
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [repoDetected, setRepoDetected] = useState<boolean | null>(null) // null = loading

  // Detect repo on mount
  useEffect(() => {
    if (!isElectron) { setRepoDetected(false); return }
    window.api
      .githubDetectRepo(workspacePath)
      .then(result => {
        if (result) {
          setOwner(result.owner)
          setRepo(result.repo)
          setDefaultBranch(result.defaultBranch ?? 'main')
          setRepoDetected(true)
        } else {
          setRepoDetected(false)
        }
      })
      .catch(() => setRepoDetected(false))
  }, [workspacePath])

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleTokenChange = (t: string) => {
    setToken(t)
    localStorage.setItem('github-pat', t)
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'prs',          label: 'Pull Requests' },
    { id: 'issues',       label: 'Issues'        },
    { id: 'create-pr',    label: 'Create PR'     },
    { id: 'create-issue', label: 'Create Issue'  },
  ]

  const repoLabel = owner && repo ? `${owner}/${repo}` : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[640px] max-w-[96vw] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          {/* GitHub mark icon */}
          <svg className="w-5 h-5 text-gray-700 dark:text-gray-300 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.3 9.42 7.88 10.95.58.1.79-.25.79-.56v-2c-3.2.69-3.87-1.54-3.87-1.54-.53-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.27-5.23-5.67 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.02 0 0 .97-.31 3.17 1.18a11 11 0 012.89-.39c.98 0 1.97.13 2.89.39 2.2-1.49 3.17-1.18 3.17-1.18.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.07 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56C20.7 21.42 24 17.1 24 12c0-6.35-5.15-11.5-12-11.5z" />
          </svg>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">GitHub Integration</h2>
            {repoLabel && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono">{repoLabel}</p>
            )}
          </div>
          {/* Change repo button */}
          {(owner || repo) && (
            <button
              onClick={() => setRepoDetected(false)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Change repository"
            >
              Change repo
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Token banner */}
        {!token && (
          <TokenBanner token={token} onChange={handleTokenChange} />
        )}

        {/* Repo detection loading */}
        {repoDetected === null ? (
          <div className="flex items-center justify-center gap-2 py-14 text-gray-400 text-sm">
            <Spinner />
            <span>Detecting repository…</span>
          </div>
        ) : !repoDetected ? (
          /* Manual repo input */
          <div className="flex-1 overflow-y-auto min-h-0">
            <RepoForm
              owner={owner}
              repo={repo}
              onSave={(o, r) => { setOwner(o); setRepo(r); setRepoDetected(true) }}
            />
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="flex border-b border-gray-100 dark:border-gray-800 flex-shrink-0 overflow-x-auto">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Token required notice (inline, for token-dependent tabs when token missing) */}
            {!token && (tab === 'prs' || tab === 'issues') && (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-1">
                <p className="text-sm text-gray-500 dark:text-gray-400">A GitHub token is required to load data.</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">Enter your token in the banner above.</p>
              </div>
            )}

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {tab === 'prs' && token && (
                <PRsTab owner={owner} repo={repo} token={token} />
              )}
              {tab === 'issues' && token && (
                <IssuesTab owner={owner} repo={repo} token={token} />
              )}
              {tab === 'create-pr' && (
                <CreatePRTab owner={owner} repo={repo} token={token} defaultBranch={defaultBranch} />
              )}
              {tab === 'create-issue' && (
                <CreateIssueTab owner={owner} repo={repo} token={token} />
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
              <span className="text-[11px] text-gray-400 dark:text-gray-600">
                {owner && repo
                  ? `${owner}/${repo} · GitHub API`
                  : 'No repository connected'}
              </span>
              {token && (
                <button
                  onClick={() => { setToken(''); localStorage.removeItem('github-pat') }}
                  className="text-[11px] text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  Clear token
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
