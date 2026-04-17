/**
 * UpdateBanner — slim notification bar shown when an app update is available,
 * downloading, or ready to install.
 *
 * States handled:
 *   available   → "Update X.X.X available"  [Download] [✕]
 *   downloading → progress bar + percentage
 *   downloaded  → "Ready to install"         [Restart now] [Install on quit]
 *   error       → dim error note             [✕]
 *
 * "checking" and "not-available" are intentionally invisible — no need to
 * show anything to the user for routine background checks.
 */

import { useState } from 'react'
import { UpdateStatusPayload } from '../../../shared/types'

interface Props {
  status:      UpdateStatusPayload | null
  onDownload:  () => void
  onInstall:   () => void
  onDismiss:   () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UpdateBanner({ status, onDownload, onInstall, onDismiss }: Props) {
  const [installOnQuit, setInstallOnQuit] = useState(false)

  if (!status) return null
  if (status.type === 'checking' || status.type === 'not-available') return null

  // ── Downloaded — ready to restart ─────────────────────────────────────────
  if (status.type === 'downloaded') {
    if (installOnQuit) {
      return (
        <div className="flex items-center gap-3 px-4 py-2 bg-green-600 dark:bg-green-700 text-white text-xs">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="flex-1">
            Update <strong>v{status.version}</strong> will install when you close the app.
          </span>
          <button
            onClick={() => { setInstallOnQuit(false); onDismiss() }}
            className="ml-auto opacity-70 hover:opacity-100 transition-opacity"
            title="Dismiss"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-3 px-4 py-2 bg-green-600 dark:bg-green-700 text-white text-xs">
        {/* rocket icon */}
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.82m5.84-2.56a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.63 2l-.36.04C6.65 4.5 5 7.78 5 11.2c0 3.42 1.49 6.25 3.85 8.25m6.74-5.08l-3.44-3.44m0 0A5.97 5.97 0 009.5 9.5m3.45 3.45A5.97 5.97 0 0015 12m-2.05 5.45L9.5 14" />
        </svg>
        <span className="flex-1">
          <strong>v{status.version}</strong> downloaded — restart to apply.
        </span>
        <button
          onClick={onInstall}
          className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg transition-colors font-medium"
        >
          Restart now
        </button>
        <button
          onClick={() => setInstallOnQuit(true)}
          className="flex items-center gap-1.5 px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
        >
          Later
        </button>
      </div>
    )
  }

  // ── Downloading — progress bar ─────────────────────────────────────────────
  if (status.type === 'downloading') {
    return (
      <div className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white text-xs">
        <div className="flex items-center gap-3 mb-1.5">
          {/* spinner */}
          <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <span className="flex-1">Downloading update… {status.percent}%</span>
          <span className="opacity-70">
            {formatBytes(status.transferred)} / {formatBytes(status.total)}
            {' · '}
            {formatBytes(status.bytesPerSecond)}/s
          </span>
        </div>
        {/* progress bar */}
        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all duration-300"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      </div>
    )
  }

  // ── Available — ask user to download ──────────────────────────────────────
  if (status.type === 'available') {
    return (
      <div className="flex items-center gap-3 px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white text-xs">
        {/* download icon */}
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span className="flex-1">
          Update <strong>v{status.version}</strong> is available.
        </span>
        <button
          onClick={onDownload}
          className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg transition-colors font-medium"
        >
          Download
        </button>
        <button
          onClick={onDismiss}
          className="opacity-70 hover:opacity-100 transition-opacity"
          title="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  // ── Error — show subtly ────────────────────────────────────────────────────
  if (status.type === 'error') {
    return (
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-700 dark:bg-gray-800 text-gray-300 text-xs">
        <svg className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span className="flex-1 truncate">Update check failed: {status.message}</span>
        <button
          onClick={onDismiss}
          className="opacity-60 hover:opacity-100 transition-opacity"
          title="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return null
}
