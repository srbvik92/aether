/**
 * Auto-updater module — wraps electron-updater.
 *
 * Behavior:
 *  - Skipped entirely in development (app is not packaged).
 *  - On app start, waits 3 s then silently checks for updates.
 *  - autoDownload = false  →  user must click "Download" in the banner.
 *  - autoInstallOnAppQuit = true  →  installs when the user quits normally.
 *  - All status events are forwarded to the renderer via IPC.UPDATE_STATUS.
 *
 * IPC surface (called from ipc-handlers.ts):
 *  update:check    → autoUpdater.checkForUpdates()
 *  update:download → autoUpdater.downloadUpdate()
 *  update:install  → autoUpdater.quitAndInstall()
 */

import { BrowserWindow, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, UpdateStatusPayload } from '../shared/types'
import { log } from './logger'

export function initUpdater(mainWindow: BrowserWindow): void {
  // Only run in packaged builds — in dev there is no update server
  if (!app.isPackaged) return

  // ── Configuration ─────────────────────────────────────────────────────────
  autoUpdater.autoDownload        = false  // user decides when to download
  autoUpdater.autoInstallOnAppQuit = true  // install silently on normal quit after download
  autoUpdater.allowPrerelease     = true  // allow x.x.x-a / x.x.x-beta style versions

  // Wire to app logger so update events appear in the log viewer
  autoUpdater.logger = {
    info:  (msg: unknown) => log.info('updater', String(msg)),
    warn:  (msg: unknown) => log.warn('updater', String(msg)),
    error: (msg: unknown) => log.error('updater', String(msg)),
    debug: (msg: unknown) => log.debug('updater', String(msg)),
  }

  // ── Helper to push status to renderer ────────────────────────────────────
  const send = (payload: UpdateStatusPayload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(IPC.UPDATE_STATUS, payload)
  }

  // ── Event wiring ─────────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    send({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    send({ type: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    send({ type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    send({
      type:           'downloading',
      percent:        Math.round(progress.percent),
      bytesPerSecond: Math.round(progress.bytesPerSecond),
      transferred:    progress.transferred,
      total:          progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    const msg = err?.message ?? String(err)
    // Silently swallow expected non-fatal conditions:
    // - "No published versions" → repo exists but no release yet
    // - "404" → private repo atom feed inaccessible without token (normal)
    // - "HttpError: 404" → same via electron-updater's HTTP client
    if (msg.includes('No published versions')) return
    if (msg.includes('404')) return
    send({ type: 'error', message: msg })
  })

  // ── Initial check ─────────────────────────────────────────────────────────
  // Delay so the window is fully rendered before any banner appears.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently swallow — update server not reachable, no internet, etc.
    })
  }, 3000)
}

// ── Exported actions (called from ipc-handlers) ───────────────────────────

export function checkForUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch(() => {/* swallow */})
}

export function downloadUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.downloadUpdate().catch(() => {/* swallow */})
}

export function installUpdate(): void {
  // setImmediate so the IPC reply can reach the renderer before quit
  setImmediate(() => autoUpdater.quitAndInstall())
}
