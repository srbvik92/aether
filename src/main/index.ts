import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers, registerParallelHandlers } from './ipc-handlers'
import { initUpdater } from './updater'
import { initTelemetry, stopTelemetry } from './telemetry'

// ── Catch silent crashes ──────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[main] Uncaught exception:', err)
  // Write to a crash file next to the exe so it's findable even if logger fails
  try {
    const { writeFileSync } = require('fs')
    const { join: pjoin } = require('path')
    writeFileSync(
      pjoin(app.getPath('userData'), 'crash.log'),
      `${new Date().toISOString()}\n${err.stack ?? err.message}\n`,
      'utf-8'
    )
  } catch { /* ignore */ }
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled rejection:', reason)
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Resolve icon path — works both in dev and in packaged app
  const iconPath = join(__dirname, '../../build',
    process.platform === 'win32'  ? 'icon.ico'  :
    process.platform === 'darwin' ? 'icon.icns' :
    'icon.png'
  )

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a1a',
      symbolColor: '#ffffff',
      height: 36
    },
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true     // enables <webview> for EmbeddedBrowserPanel
    }
  })

  // Register all IPC handlers
  registerIpcHandlers(mainWindow)
  registerParallelHandlers()

  // Remove default menu
  Menu.setApplicationMenu(null)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
    // Start the update checker after the window is shown
    if (mainWindow) initUpdater(mainWindow)
  })

  // Fallback: show window after 8s in case ready-to-show is delayed (Windows / slow GPU init)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }, 8000)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Open DevTools in dev so we can see renderer errors
  if (is.dev) {
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error('[renderer] did-fail-load:', code, desc)
      mainWindow?.show()
    })
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer] render-process-gone:', details.reason, details.exitCode)
    })
  }

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.yourname.ai-code-app')
  initTelemetry()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopTelemetry()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
