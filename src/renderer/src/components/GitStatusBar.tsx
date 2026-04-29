/**
 * GitStatusBar — live git status at the bottom of the sidebar, with
 * an expandable commit panel and AI-powered commit message generation.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { AppSettings, GitStatusSummary } from '../../../shared/types'

interface Props {
  workspacePath: string
  settings?:     AppSettings
}

const isElectron = typeof window !== 'undefined' && !!window.api

export default function GitStatusBar({ workspacePath, settings }: Props) {
  const [status,       setStatus]       = useState<GitStatusSummary | null>(null)
  const [commitOpen,   setCommitOpen]   = useState(false)
  const [message,      setMessage]      = useState('')
  const [generating,   setGenerating]   = useState(false)
  const [committing,   setCommitting]   = useState(false)
  const [feedback,     setFeedback]     = useState<{ ok: boolean; text: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const refresh = useCallback(async () => {
    if (!isElectron || !workspacePath) { setStatus(null); return }
    try {
      const s = await window.api.getGitStatus(workspacePath)
      setStatus(s.isRepo ? s : null)
    } catch { setStatus(null) }
  }, [workspacePath])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!workspacePath) return
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [refresh, workspacePath])

  // Auto-resize textarea
  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }
  useEffect(autoResize, [message])

  if (!status) return null

  const hasPendingChanges = !status.isClean
  const canCommit         = status.staged > 0

  // ── Generate commit message ──────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!settings || !isElectron) return
    setGenerating(true)
    setFeedback(null)
    try {
      const res = await window.api.gitGenerateMsg(workspacePath, settings)
      if (res.ok && res.message) {
        setMessage(res.message)
      } else {
        setFeedback({ ok: false, text: res.error ?? 'Generation failed' })
      }
    } catch (e) {
      setFeedback({ ok: false, text: String(e) })
    } finally {
      setGenerating(false)
    }
  }

  // ── Stage all + commit ───────────────────────────────────────────────────
  const handleStageAll = async () => {
    if (!isElectron) return
    await window.api.gitStageAll(workspacePath)
    await refresh()
  }

  const handleCommit = async () => {
    if (!message.trim() || !isElectron) return
    setCommitting(true)
    setFeedback(null)
    try {
      const res = await window.api.gitDoCommit(workspacePath, message.trim())
      if (res.ok) {
        setFeedback({ ok: true, text: 'Committed ✓' })
        setMessage('')
        setCommitOpen(false)
        await refresh()
      } else {
        setFeedback({ ok: false, text: res.output || 'Commit failed' })
      }
    } catch (e) {
      setFeedback({ ok: false, text: String(e) })
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-800">

      {/* ── Status row ── */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 7a4 4 0 104 4v1a4 4 0 104-4V7m-8 0V5a2 2 0 012-2h4a2 2 0 012 2v2M8 7h8" />
          </svg>
          <span className="font-mono font-medium text-gray-700 dark:text-gray-300 truncate max-w-[90px]">
            {status.branch}
          </span>
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="text-[10px]">
              {status.ahead  > 0 && <span className="text-blue-500">↑{status.ahead}</span>}
              {status.behind > 0 && <span className="text-orange-500 ml-0.5">↓{status.behind}</span>}
            </span>
          )}
          {status.isClean && (
            <span className="ml-auto text-[10px] text-green-500 dark:text-green-600">✓ clean</span>
          )}

          {/* Commit panel toggle */}
          {hasPendingChanges && (
            <button
              onClick={() => setCommitOpen(v => !v)}
              title={commitOpen ? 'Close commit panel' : 'Open commit panel'}
              className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                commitOpen
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                  : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Commit
            </button>
          )}
        </div>

        {/* Changes summary */}
        {hasPendingChanges && !commitOpen && (
          <div className="flex items-center gap-2 mt-1 text-[10px]">
            {status.staged    > 0 && <span className="text-green-600 dark:text-green-500"><b>+</b>{status.staged} staged</span>}
            {status.unstaged  > 0 && <span className="text-yellow-600 dark:text-yellow-500"><b>~</b>{status.unstaged} unstaged</span>}
            {status.untracked > 0 && <span className="text-gray-400 dark:text-gray-600"><b>?</b>{status.untracked} untracked</span>}
            <button onClick={refresh} className="ml-auto text-gray-300 dark:text-gray-700 hover:text-gray-500 dark:hover:text-gray-400 transition-colors" title="Refresh">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* ── Commit panel ── */}
      {commitOpen && (
        <div className="px-3 pb-3 space-y-2">

          {/* Staged / unstaged summary */}
          <div className="flex items-center gap-2 text-[10px]">
            {status.staged    > 0 && <span className="text-green-600 dark:text-green-500"><b>+</b>{status.staged} staged</span>}
            {status.unstaged  > 0 && <span className="text-yellow-600 dark:text-yellow-500"><b>~</b>{status.unstaged} unstaged</span>}
            {status.untracked > 0 && <span className="text-gray-400"><b>?</b>{status.untracked} untracked</span>}
            {(status.unstaged > 0 || status.untracked > 0) && (
              <button
                onClick={handleStageAll}
                className="ml-auto text-[10px] text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Stage all changes (git add -A)"
              >
                Stage all
              </button>
            )}
          </div>

          {/* Message textarea */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={e => { setMessage(e.target.value); autoResize() }}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleCommit() }
              }}
              placeholder="Commit message…"
              rows={2}
              className="w-full text-xs bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200
                         border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-2
                         placeholder-gray-400 resize-none outline-none
                         focus:border-blue-400 dark:focus:border-blue-600 transition-colors
                         font-mono leading-relaxed"
              style={{ minHeight: '52px' }}
            />
          </div>

          {/* Action row */}
          <div className="flex items-center gap-1.5">
            {/* ✨ Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating || !canCommit}
              title={canCommit ? 'Generate commit message with AI' : 'Stage some changes first'}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                generating
                  ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-400 border-purple-200 dark:border-purple-700 cursor-wait'
                  : canCommit
                    ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-700 hover:bg-purple-100 dark:hover:bg-purple-800/40'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 border-gray-200 dark:border-gray-700 cursor-not-allowed'
              }`}
            >
              {generating ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <span>✨</span>
              )}
              {generating ? 'Generating…' : 'Generate'}
            </button>

            {/* Commit button */}
            <button
              onClick={handleCommit}
              disabled={!message.trim() || committing || !canCommit}
              title={!canCommit ? 'Stage some changes first' : 'Commit staged changes (Ctrl+Enter)'}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                message.trim() && canCommit && !committing
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
              }`}
            >
              {committing ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {committing ? 'Committing…' : 'Commit'}
            </button>
          </div>

          {/* Feedback */}
          {feedback && (
            <p className={`text-[10px] px-1 ${feedback.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
              {feedback.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
