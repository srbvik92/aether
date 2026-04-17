/**
 * Local HTTP API server — lets external tools (scripts, CI, other apps)
 * send prompts to the AI agent via REST.
 *
 * Endpoints:
 *   GET  /api/status          → { ok: true, version: string }
 *   POST /api/chat            → streams AI response as plain text
 *   GET  /api/models          → { provider, model }
 *
 * Start/stop is controlled by the user via Settings.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { AppSettings } from '../shared/types'
import { runAnthropicAgentLoop } from './agent-loop'
import { runOpenAIAgentLoop } from './openai-agent-loop'
import { runGeminiAgentLoop } from './gemini-agent-loop'
import { log } from './logger'

let server: Server | null = null
let currentPort = 39400

// ── Parse request body ─────────────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) }
      catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

// ── CORS helper ────────────────────────────────────────────────────────────

function setCors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// ── Settings accessor (injected at start time) ─────────────────────────────

let getSettingsFn: (() => AppSettings) | null = null

export function startApiServer(
  port: number,
  getSettings: () => AppSettings
): { ok: boolean; error?: string } {
  if (server) return { ok: true }   // already running

  getSettingsFn = getSettings
  currentPort   = port

  try {
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      setCors(res)

      // Preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = req.url ?? '/'

      // ── GET /api/status ──────────────────────────────────────────
      if (req.method === 'GET' && url === '/api/status') {
        const settings = getSettingsFn?.()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok:      true,
          version: '1.0.0',
          model:   settings?.model ?? 'unknown',
          provider: settings?.provider ?? 'unknown'
        }))
        return
      }

      // ── GET /api/models ──────────────────────────────────────────
      if (req.method === 'GET' && url === '/api/models') {
        const settings = getSettingsFn?.()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          provider: settings?.provider,
          model:    settings?.model
        }))
        return
      }

      // ── POST /api/chat ───────────────────────────────────────────
      if (req.method === 'POST' && url === '/api/chat') {
        const settings = getSettingsFn?.()
        if (!settings) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Settings not available' }))
          return
        }

        const body = await parseBody(req)
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'prompt is required' }))
          return
        }

        // Stream plain text response
        res.writeHead(200, {
          'Content-Type':      'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked',
          'X-Accel-Buffering': 'no'
        })

        const ac = new AbortController()
        req.on('close', () => ac.abort())

        try {
          const overrideSettings: AppSettings = {
            ...settings,
            ...(typeof body.model       === 'string' && { model:        body.model }),
            ...(typeof body.temperature === 'number' && { temperature:  body.temperature }),
          }

          const messages = [{ role: 'user' as const, content: prompt }]
          const callbacks = {
            onTextChunk:       (t: string)                                          => { try { res.write(t) } catch { /* ignore */ } },
            onToolCallStart:   (_id: string, name: string)                          => { try { res.write(`\n[tool: ${name}]\n`) } catch { /* ignore */ } },
            onToolCallResult:  ()                                                    => {},
            onToolOutputChunk: ()                                                    => {},
            onDiffRequest:     async ()                                              => true,   // auto-approve in API mode
            abortSignal:       ac.signal
          }

          if (overrideSettings.provider === 'anthropic') {
            await runAnthropicAgentLoop(messages, overrideSettings, callbacks)
          } else if (overrideSettings.provider === 'openai' || overrideSettings.provider === 'custom') {
            await runOpenAIAgentLoop(messages, overrideSettings, callbacks)
          } else if (overrideSettings.provider === 'gemini') {
            await runGeminiAgentLoop(messages, overrideSettings, callbacks)
          }
        } catch (e) {
          log.error('http-api', 'Error in /api/chat', { error: String(e) })
        }

        res.end()
        return
      }

      // ── 404 ──────────────────────────────────────────────────────
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    server.on('error', (err) => {
      log.error('http-api', 'Server error', { error: String(err) })
      server = null
    })

    server.listen(port, '127.0.0.1', () => {
      log.info('http-api', `API server listening on http://127.0.0.1:${port}`)
    })

    return { ok: true }
  } catch (e) {
    server = null
    return { ok: false, error: String(e) }
  }
}

export function stopApiServer(): { ok: boolean } {
  if (!server) return { ok: true }
  server.close()
  server = null
  log.info('http-api', 'API server stopped')
  return { ok: true }
}

export function isApiServerRunning(): boolean {
  return server !== null
}

export function getApiServerPort(): number {
  return currentPort
}
