/**
 * File-based logger for the main process.
 *
 * Writes to:  <userData>/logs/main-YYYY-MM-DD.log
 *
 * Usage:
 *   import { log } from './logger'
 *   log.info('agent-loop', 'Sending to Gemini', { model, tokens })
 *   log.error('gemini', 'API call failed', err)
 *
 * Log format (one JSON line per entry):
 *   {"ts":"2026-04-12T10:23:01.123Z","level":"INFO","tag":"gemini","msg":"...","data":{...}}
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'fs'

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_LOG_FILES  = 7    // keep 7 days of logs
const MAX_FILE_BYTES = 10 * 1024 * 1024  // 10 MB per file, then rotate

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

// ── Internal state ────────────────────────────────────────────────────────────
let logDir:  string | null = null
let logFile: string | null = null

function ensureLogDir(): string {
  if (!logDir) {
    logDir = join(app.getPath('userData'), 'logs')
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

function todayFileName(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `main-${y}-${m}-${day}.log`
}

function getLogFile(): string {
  const dir  = ensureLogDir()
  const file = join(dir, todayFileName())

  // Rotate if file exceeds size limit
  if (existsSync(file) && statSync(file).size > MAX_FILE_BYTES) {
    const ts = Date.now()
    unlinkSync(file)  // simple rotation: just delete and start fresh
    console.log(`[logger] Rotated log file at ${ts}`)
  }

  // Prune old files — keep only MAX_LOG_FILES most recent
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith('main-') && f.endsWith('.log'))
      .sort()
      .reverse()
    files.slice(MAX_LOG_FILES).forEach(f => {
      try { unlinkSync(join(dir, f)) } catch { /* ignore */ }
    })
  } catch { /* ignore prune errors */ }

  logFile = file
  return file
}

function write(level: Level, tag: string, msg: string, data?: unknown): void {
  const entry = {
    ts:    new Date().toISOString(),
    level,
    tag,
    msg,
    ...(data !== undefined ? { data } : {})
  }

  const line = JSON.stringify(entry) + '\n'

  // Always mirror to console in dev
  if (process.env.NODE_ENV !== 'production') {
    const prefix = `[${entry.ts}] [${level}] [${tag}]`
    if (level === 'ERROR') console.error(prefix, msg, data ?? '')
    else if (level === 'WARN')  console.warn(prefix, msg, data ?? '')
    else                        console.log(prefix, msg, data ?? '')
  }

  try {
    appendFileSync(getLogFile(), line, 'utf-8')
  } catch (err) {
    console.error('[logger] Failed to write log:', err)
  }
}

// ── Serialise errors safely ───────────────────────────────────────────────────
function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err

  // Start with the basics
  const base: Record<string, unknown> = {
    name:    err.name,
    message: err.message,
    stack:   err.stack,
  }

  // Capture all own enumerable properties on the error object
  // (Anthropic SDK adds: status, headers, error, request_id, cause)
  // (OpenAI SDK adds: status, headers, error, code, param, type)
  // (Fetch/net errors add: cause, code)
  for (const key of Object.keys(err as object)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue
    try {
      const val = (err as Record<string, unknown>)[key]
      // Avoid circular refs / unserializable objects — stringify test
      JSON.stringify(val)
      base[key] = val
    } catch {
      base[key] = String((err as Record<string, unknown>)[key])
    }
  }

  // Also check non-enumerable API fields often set directly on prototype instances
  for (const key of ['status', 'statusCode', 'code', 'type', 'param', 'error', 'request_id', 'cause'] as const) {
    if (key in base) continue   // already captured
    const val = (err as Record<string, unknown>)[key]
    if (val !== undefined) {
      try {
        JSON.stringify(val)
        base[key] = val
      } catch {
        base[key] = String(val)
      }
    }
  }

  return base
}

// ── Public API ────────────────────────────────────────────────────────────────
export const log = {
  debug: (tag: string, msg: string, data?: unknown) => write('DEBUG', tag, msg, data),
  info:  (tag: string, msg: string, data?: unknown) => write('INFO',  tag, msg, data),
  warn:  (tag: string, msg: string, data?: unknown) => write('WARN',  tag, msg, data),
  error: (tag: string, msg: string, err?: unknown)  => write('ERROR', tag, msg, serializeError(err)),

  /** Returns the path to today's log file (for displaying in Settings) */
  getLogPath: (): string => {
    try { return getLogFile() } catch { return 'unavailable' }
  }
}
