/**
 * Local telemetry — tracks usage metrics to a local JSON file.
 * NEVER sends data externally. Users can opt out via settings.
 * Data is stored at userData/telemetry.json.
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

interface TelemetryData {
  installId:     string   // anonymous installation ID (no PII)
  firstLaunch:   string   // ISO date
  lastLaunch:    string   // ISO date
  launchCount:   number
  totalMessages: number
  totalToolCalls: number
  providerUsage: Record<string, number>   // { anthropic: 150, openai: 30 }
  modelUsage:    Record<string, number>   // { 'claude-opus-4-6': 100 }
  modeUsage:     Record<string, number>   // { code: 200, agent: 15, voice: 5 }
  featureUsage:  Record<string, number>   // { terminal: 10, github: 3 }
  errors:        Array<{ message: string; timestamp: string }>  // last 20 errors
  version:       string
}

let _data: TelemetryData | null = null
let _dirty = false
let _flushTimer: ReturnType<typeof setInterval> | null = null

function telemetryPath(): string {
  return join(app.getPath('userData'), 'telemetry.json')
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

function load(): TelemetryData {
  if (_data) return _data

  const path = telemetryPath()
  try {
    if (existsSync(path)) {
      _data = JSON.parse(readFileSync(path, 'utf-8')) as TelemetryData
      return _data
    }
  } catch { /* corrupt file — start fresh */ }

  _data = {
    installId:      generateId(),
    firstLaunch:    new Date().toISOString(),
    lastLaunch:     new Date().toISOString(),
    launchCount:    0,
    totalMessages:  0,
    totalToolCalls: 0,
    providerUsage:  {},
    modelUsage:     {},
    modeUsage:      {},
    featureUsage:   {},
    errors:         [],
    version:        app.getVersion()
  }
  return _data
}

function flush(): void {
  if (!_data || !_dirty) return
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(telemetryPath(), JSON.stringify(_data, null, 2))
    _dirty = false
  } catch { /* ignore write errors */ }
}

export function initTelemetry(): void {
  const data = load()
  data.launchCount++
  data.lastLaunch = new Date().toISOString()
  data.version    = app.getVersion()
  _dirty = true
  flush()

  // Auto-flush every 60 seconds
  _flushTimer = setInterval(flush, 60_000)
}

export function stopTelemetry(): void {
  flush()
  if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null }
}

export function trackMessage(provider: string, model: string, mode: string): void {
  const data = load()
  data.totalMessages++
  data.providerUsage[provider] = (data.providerUsage[provider] ?? 0) + 1
  data.modelUsage[model]       = (data.modelUsage[model] ?? 0) + 1
  data.modeUsage[mode]         = (data.modeUsage[mode] ?? 0) + 1
  _dirty = true
}

export function trackToolCall(toolName: string): void {
  const data = load()
  data.totalToolCalls++
  _dirty = true
}

export function trackFeature(feature: string): void {
  const data = load()
  data.featureUsage[feature] = (data.featureUsage[feature] ?? 0) + 1
  _dirty = true
}

export function trackError(message: string): void {
  const data = load()
  data.errors.push({ message: message.slice(0, 300), timestamp: new Date().toISOString() })
  if (data.errors.length > 20) data.errors.splice(0, data.errors.length - 20)
  _dirty = true
}

export function getTelemetryData(): TelemetryData {
  return { ...load() }
}
