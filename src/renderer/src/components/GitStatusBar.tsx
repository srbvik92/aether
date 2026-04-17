/**
 * GitStatusBar — shows live git info at the bottom of the sidebar.
 *
 * Displays: branch name, ahead/behind, staged/unstaged counts.
 * Polls every 10 seconds when a workspace is set.
 * Shows nothing if workspace is not a git repo.
 */

import { useState, useEffect, useCallback } from 'react'
import { GitStatusSummary } from '../../../shared/types'

interface Props {
  workspacePath: string
}

const isElectron = typeof window !== 'undefined' && !!window.api

export default function GitStatusBar({ workspacePath }: Props) {
  const [status, setStatus] = useState<GitStatusSummary | null>(null)

  const refresh = useCallback(async () => {
    if (!isElectron || !workspacePath) { setStatus(null); return }
    try {
      const s = await window.api.getGitStatus(workspacePath)
      setStatus(s.isRepo ? s : null)
    } catch {
      setStatus(null)
    }
  }, [workspacePath])

  // Refresh on mount + when workspace changes
  useEffect(() => { refresh() }, [refresh])

  // Poll every 10s
  useEffect(() => {
    if (!workspacePath) return
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [refresh, workspacePath])

  if (!status) return null

  const hasPendingChanges = !status.isClean
  const changesCount = status.staged + status.unstaged

  return (
    <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800">
      {/* Branch row */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        {/* Branch icon */}
        <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M8 7a4 4 0 104 4v1a4 4 0 104-4V7m-8 0V5a2 2 0 012-2h4a2 2 0 012 2v2M8 7h8" />
        </svg>

        <span className="font-mono font-medium text-gray-700 dark:text-gray-300 truncate max-w-[100px]">
          {status.branch}
        </span>

        {/* Ahead/behind */}
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="text-gray-400 dark:text-gray-600 text-[10px]">
            {status.ahead > 0 && <span className="text-blue-500">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="text-orange-500 ml-0.5">↓{status.behind}</span>}
          </span>
        )}

        {/* Clean indicator */}
        {status.isClean && (
          <span className="ml-auto text-[10px] text-green-500 dark:text-green-600">✓ clean</span>
        )}
      </div>

      {/* Changes row */}
      {hasPendingChanges && (
        <div className="flex items-center gap-2 mt-1 text-[10px]">
          {status.staged > 0 && (
            <span className="flex items-center gap-0.5 text-green-600 dark:text-green-500">
              <span className="font-bold">+</span>{status.staged} staged
            </span>
          )}
          {status.unstaged > 0 && (
            <span className="flex items-center gap-0.5 text-yellow-600 dark:text-yellow-500">
              <span className="font-bold">~</span>{status.unstaged} unstaged
            </span>
          )}
          {status.untracked > 0 && (
            <span className="flex items-center gap-0.5 text-gray-400 dark:text-gray-600">
              <span className="font-bold">?</span>{status.untracked} untracked
            </span>
          )}
          <button
            onClick={refresh}
            className="ml-auto text-gray-300 dark:text-gray-700 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
            title="Refresh git status"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
