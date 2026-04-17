/**
 * Terminal manager — wraps node-pty to manage multiple PTY sessions.
 *
 * Each session maps a unique sessionId (UUID) to an IPty instance.
 * Output from the PTY is forwarded to the renderer via IPC (TERMINAL_DATA).
 * The renderer sends keystrokes/pastes back via TERMINAL_WRITE.
 *
 * Shell selection:
 *   Windows:  PowerShell 7 (pwsh.exe) → PowerShell 5 (powershell.exe) → cmd.exe
 *   Unix:     $SHELL → /bin/bash
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { IPC } from '../shared/types'

// Import node-pty dynamically to handle graceful failure if binary is missing
let pty: typeof import('@homebridge/node-pty-prebuilt-multiarch') | null = null
try {
  pty = require('@homebridge/node-pty-prebuilt-multiarch')
} catch {
  console.warn('[terminal] node-pty not available — terminal panel will be disabled')
}

export const PTY_AVAILABLE = pty !== null

// ── Shell detection ───────────────────────────────────────────────────────────

function detectShell(): string {
  if (process.platform === 'win32') {
    // Prefer PowerShell 7 (cross-platform), fall back to 5, then cmd
    const pwsh7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    if (existsSync(pwsh7)) return pwsh7
    return process.env.ComSpec || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

// ── Session map ───────────────────────────────────────────────────────────────

interface Session {
  pty: import('@homebridge/node-pty-prebuilt-multiarch').IPty
}

const sessions = new Map<string, Session>()

// ── Public API ────────────────────────────────────────────────────────────────

export function createTerminalSession(
  mainWindow: BrowserWindow,
  workspacePath: string,
  cols: number,
  rows: number
): { sessionId: string; error?: string } {
  if (!pty) return { sessionId: '', error: 'node-pty is not available' }

  const sessionId = randomUUID()
  const shell = detectShell()
  const cwd = workspacePath || process.env.HOME || process.env.USERPROFILE || '/'

  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        // Make sure the shell knows its a real terminal
        TERM_PROGRAM: 'AI-Code-App',
      } as Record<string, string>
    })

    ptyProcess.onData((data: string) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.TERMINAL_DATA, { sessionId, data })
      }
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      sessions.delete(sessionId)
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.TERMINAL_EXIT, { sessionId, exitCode })
      }
    })

    sessions.set(sessionId, { pty: ptyProcess })
    return { sessionId }
  } catch (err) {
    return { sessionId: '', error: err instanceof Error ? err.message : String(err) }
  }
}

export function writeTerminalSession(sessionId: string, data: string): void {
  const session = sessions.get(sessionId)
  if (session) session.pty.write(data)
}

export function resizeTerminalSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId)
  if (session) {
    try { session.pty.resize(cols, rows) } catch { /* ignore if process already exited */ }
  }
}

export function killTerminalSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    try { session.pty.kill() } catch { /* ignore */ }
    sessions.delete(sessionId)
  }
}

export function killAllTerminalSessions(): void {
  sessions.forEach(({ pty: p }, id) => {
    try { p.kill() } catch { /* ignore */ }
    sessions.delete(id)
  })
}
