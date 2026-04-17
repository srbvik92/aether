/**
 * Shell command approval modal.
 *
 * Shown when the AI calls run_command with a command that is not in the
 * trusted-commands allowlist. The user can approve once, reject, or add
 * the command to the trusted list so it runs silently in the future.
 */

import { useEffect, useCallback } from 'react'
import { CmdApprovalPayload, AppSettings, DEFAULT_SETTINGS } from '../../../shared/types'

const isElectron = typeof window !== 'undefined' && !!window.api

interface Props {
  payload:    CmdApprovalPayload
  onApprove:  () => void
  onReject:   () => void
  onTrust:    (command: string) => void   // add to trusted list
  settings:   AppSettings
}

/** Return just the first "word group" of a command, e.g. "npm run build" → "npm run build" */
function commandPrefix(cmd: string): string {
  // Take up to the first flag or argument that looks like a value
  const parts = cmd.trim().split(/\s+/)
  // Collect tokens until we hit something that starts with a value (non-flag, non-subcommand)
  const prefix: string[] = []
  for (const p of parts) {
    if (p.startsWith('-') && prefix.length > 0) break   // stop at first flag
    prefix.push(p)
    if (prefix.length >= 4) break                        // max 4-word prefix
  }
  return prefix.join(' ')
}

export default function CmdApprovalModal({ payload, onApprove, onReject, onTrust, settings }: Props) {
  const { command, workspace, isDangerous } = payload

  // Enter = approve, Escape = reject (unless dangerous — safety first)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onReject() }
      if (e.key === 'Enter' && !isDangerous) { e.preventDefault(); onApprove() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDangerous, onApprove, onReject])

  const handleTrustAndApprove = useCallback(() => {
    onTrust(commandPrefix(command))
    onApprove()
  }, [command, onTrust, onApprove])

  const workspaceLabel = workspace
    ? workspace.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
    : '(no workspace)'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[520px] max-w-[92vw] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* Header */}
        <div className={`px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-start gap-3 ${
          isDangerous ? 'bg-red-50 dark:bg-red-950/40' : 'bg-yellow-50 dark:bg-yellow-950/30'
        }`}>
          <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            isDangerous
              ? 'bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-400'
              : 'bg-yellow-100 dark:bg-yellow-900/60 text-yellow-600 dark:text-yellow-400'
          }`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`text-sm font-semibold ${
              isDangerous ? 'text-red-700 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-200'
            }`}>
              {isDangerous ? '⚠ Potentially destructive command' : 'AI wants to run a command'}
            </h3>
            <p className={`text-xs mt-0.5 ${
              isDangerous ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'
            }`}>
              {isDangerous
                ? 'This command matches a known dangerous pattern. Review it carefully before approving.'
                : 'This command is not in your trusted list. Approve to run it once, or add it to trusted commands.'
              }
            </p>
          </div>
        </div>

        {/* Command display */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Command</p>
            <div className="flex items-start gap-2 px-3 py-2.5 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <span className="text-gray-400 dark:text-gray-600 font-mono text-xs mt-0.5 flex-shrink-0">$</span>
              <code className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">{command}</code>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Working directory</p>
            <p className="text-xs text-gray-500 dark:text-gray-500 font-mono truncate" title={workspace}>{workspaceLabel}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 space-y-2">
          {/* Primary row */}
          <div className="flex items-center gap-2">
            <button
              onClick={onApprove}
              className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm transition-colors text-white ${
                isDangerous
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-green-600 hover:bg-green-500'
              }`}
            >
              {isDangerous ? 'Run anyway' : 'Run'}
              {!isDangerous && <span className="ml-2 text-[10px] opacity-70">↵ Enter</span>}
            </button>
            <button
              onClick={onReject}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                         hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-sm
                         text-gray-700 dark:text-gray-300 transition-colors"
            >
              Reject
              <span className="ml-2 text-[10px] opacity-50">Esc</span>
            </button>
          </div>

          {/* Trust option — only for non-dangerous commands */}
          {!isDangerous && (
            <button
              onClick={handleTrustAndApprove}
              className="w-full px-4 py-2 rounded-xl border border-blue-200 dark:border-blue-700
                         bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40
                         text-blue-700 dark:text-blue-300 text-xs font-medium transition-colors"
            >
              ✓ Always trust "{commandPrefix(command)}" and run
            </button>
          )}

          <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 pt-1">
            Manage trusted commands in Settings → Trusted Commands
          </p>
        </div>
      </div>
    </div>
  )
}
