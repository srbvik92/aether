/**
 * File watcher for Pair mode.
 * Uses chokidar when available (more reliable cross-platform watching),
 * falls back to Node's built-in fs.watch.
 */

import { relative, extname } from 'path'
import { BrowserWindow } from 'electron'
import { IPC } from '../shared/types'

// File extensions we care about (skip node_modules, .git, images, etc.)
const WATCH_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.rs', '.go', '.java', '.kt', '.swift', '.cs',
  '.cpp', '.c', '.h', '.hpp',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.html', '.css', '.scss', '.sql', '.sh', '.bash',
  '.md', '.mdx', '.txt', '.env', '.graphql', '.prisma', '.proto'
])

const IGNORE_PATTERNS = [
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  '__pycache__', '.cache', '.vscode', '.idea',
  '.ai-snapshots', '.ai-memory', '.ai-context'
]

function shouldWatch(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  if (!WATCH_EXTENSIONS.has(ext)) return false
  if (IGNORE_PATTERNS.some(p => filePath.replace(/\\/g, '/').includes(p))) return false
  return true
}

type AnyWatcher = { close(): void } | null

let activeWatcher: AnyWatcher = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const recentChanges: Array<{ path: string; type: string; timestamp: number }> = []

function flushChanges(mainWindow: BrowserWindow) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const now = Date.now()
    // Drop stale entries
    const fresh = recentChanges.filter(c => now - c.timestamp < 5000)
    recentChanges.length = 0
    recentChanges.push(...fresh)

    const unique = new Map<string, string>()
    for (const c of recentChanges) unique.set(c.path, c.type)

    const changes = Array.from(unique.entries()).map(([path, type]) => ({ path, type }))
    if (changes.length > 0 && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.FILE_WATCH_CHANGE, { changes })
      recentChanges.length = 0
    }
  }, 1500)
}

function recordChange(workspacePath: string, filePath: string, eventType: string, mainWindow: BrowserWindow) {
  if (!shouldWatch(filePath)) return
  const rel = relative(workspacePath, filePath).replace(/\\/g, '/')
  recentChanges.push({ path: rel, type: eventType, timestamp: Date.now() })
  flushChanges(mainWindow)
}

export function startFileWatcher(workspacePath: string, mainWindow: BrowserWindow): { ok: boolean; error?: string } {
  stopFileWatcher()

  // Try chokidar first (reliable cross-platform watching)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const chokidar = require('chokidar') as typeof import('chokidar')
    const watcher = chokidar.watch(workspacePath, {
      ignored: (p: string) => IGNORE_PATTERNS.some(pat => p.replace(/\\/g, '/').includes(`/${pat}/`) || p.replace(/\\/g, '/').endsWith(`/${pat}`)),
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      depth: 15
    })

    watcher.on('add',    (p: string) => recordChange(workspacePath, p, 'rename', mainWindow))
    watcher.on('change', (p: string) => recordChange(workspacePath, p, 'change', mainWindow))
    watcher.on('unlink', (p: string) => recordChange(workspacePath, p, 'rename', mainWindow))

    activeWatcher = watcher
    return { ok: true }
  } catch {
    // chokidar not installed — fall back to fs.watch
  }

  // Fallback: built-in fs.watch (less reliable on some OSes)
  try {
    const { watch } = require('fs') as typeof import('fs')
    const fsWatcher = watch(workspacePath, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      const full = require('path').join(workspacePath, filename)
      recordChange(workspacePath, full, eventType ?? 'change', mainWindow)
    })
    activeWatcher = fsWatcher
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function stopFileWatcher(): void {
  if (activeWatcher) {
    try { activeWatcher.close() } catch { /* ignore */ }
    activeWatcher = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  recentChanges.length = 0
}

export function isWatching(): boolean {
  return activeWatcher !== null
}
