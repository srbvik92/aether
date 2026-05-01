import { spawn, ChildProcess, execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { IPC, DevServerStatusPayload, DevServerLogPayload, DevServerState } from '../shared/types'

let devProcess: ChildProcess | null = null
let detectedUrl: string | null = null
let currentState: DevServerState = 'stopped'

// ── URL detection patterns ────────────────────────────────────────────────────
const URL_PATTERNS = [
  /Local:\s+(https?:\/\/localhost:\d+)/i,          // Vite
  /➜\s+Local:\s+(https?:\/\/[^\s]+)/i,             // Vite alt
  /started server on\s+\S+,\s+url:\s+(https?:\/\/[^\s]+)/i,  // Next.js
  /ready\s+-\s+started server on\s+\S+\s+\(https?:\/\/[^\s]+\)\s+url:\s+(https?:\/\/[^\s]+)/i,
  /localhost:(\d+)/i,                               // generic — extract port
  /127\.0\.0\.1:(\d+)/i,
  /on port (\d+)/i,
  /running at (https?:\/\/[^\s]+)/i,               // CRA
  /App running at:\s*\n\s*-\s+Local:\s+(https?:\/\/[^\s]+)/im,  // Vue CLI
]

function extractUrl(line: string): string | null {
  for (const pattern of URL_PATTERNS) {
    const m = line.match(pattern)
    if (m) {
      // If match is just a port number, build the full URL
      if (/^\d+$/.test(m[1])) return `http://localhost:${m[1]}`
      if (m[1].startsWith('http')) return m[1]
    }
  }
  return null
}

function detectCommand(workspacePath: string): string {
  try {
    const pkgPath = join(workspacePath, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const scripts: Record<string, string> = pkg.scripts ?? {}
      // Prefer dev, then start, then serve
      for (const name of ['dev', 'start', 'serve', 'preview']) {
        if (scripts[name]) return `npm run ${name}`
      }
    }
  } catch { /* ignore */ }
  return 'npm run dev'
}

function sendStatus(win: BrowserWindow, payload: DevServerStatusPayload) {
  currentState = payload.state
  win.webContents.send(IPC.DEV_SERVER_STATUS, payload)
}

function sendLog(win: BrowserWindow, line: string, isError = false) {
  const payload: DevServerLogPayload = { line, isError }
  win.webContents.send(IPC.DEV_SERVER_LOG, payload)
}

export function startDevServer(workspacePath: string, command?: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (devProcess) stopDevServer()

  const cmd = command ?? detectCommand(workspacePath)
  detectedUrl = null
  sendStatus(win, { state: 'starting' })
  sendLog(win, `$ ${cmd}`)

  const [prog, ...args] = process.platform === 'win32'
    ? ['powershell.exe', '-NonInteractive', '-Command', cmd]
    : ['sh', '-c', cmd]

  devProcess = spawn(prog, args, {
    cwd: workspacePath,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const handleLine = (data: Buffer, isErr: boolean) => {
    const text = data.toString().replace(/\x1B\[[0-9;]*m/g, '') // strip ANSI
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      sendLog(win, trimmed, isErr)

      // Detect URL from stdout
      if (!detectedUrl && !isErr) {
        const url = extractUrl(trimmed)
        if (url) {
          detectedUrl = url
          sendStatus(win, { state: 'running', url })
        }
      }
    }
  }

  devProcess.stdout?.on('data', d => handleLine(d, false))
  devProcess.stderr?.on('data', d => handleLine(d, true))

  devProcess.on('error', (err) => {
    sendStatus(win, { state: 'error', error: err.message })
    devProcess = null
  })

  devProcess.on('close', () => {
    if (currentState !== 'stopped') {
      sendStatus(win, { state: 'stopped' })
    }
    devProcess = null
    detectedUrl = null
  })

  // Fallback: if no URL detected after 15s but process is alive, mark as running
  setTimeout(() => {
    if (devProcess && currentState === 'starting') {
      sendStatus(win, { state: 'running', url: detectedUrl ?? undefined })
    }
  }, 15_000)
}

export function stopDevServer(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (devProcess) {
    if (process.platform === 'win32' && devProcess.pid) {
      try {
        execSync(`taskkill /pid ${devProcess.pid} /T /F`, { stdio: 'ignore' })
      } catch { devProcess.kill() }
    } else {
      devProcess.kill('SIGTERM')
    }
    devProcess = null
    detectedUrl = null
  }
  if (win) {
    sendStatus(win, { state: 'stopped' })
    sendLog(win, 'Dev server stopped.')
  }
}

export function getDevServerState() {
  return { state: currentState, url: detectedUrl }
}

// Kill on app exit
process.on('exit', () => { try { devProcess?.kill() } catch { /* ignore */ } })
