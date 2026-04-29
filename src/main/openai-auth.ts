/**
 * OpenAI OAuth 2.0 + PKCE login flow for desktop apps.
 *
 * Uses the same public client registered by OpenAI's own Codex CLI
 * (client_id: app_EMoamEEZ73f0CkXaXp7hrann) — no app registration needed.
 *
 * The resulting access_token can be used as a Bearer token with:
 *   • https://chatgpt.com/backend-api/codex/responses  (ChatGPT Plus/Pro subscription)
 *   • https://api.openai.com/v1                        (API credits, fallback)
 *
 * Parameters reverse-engineered from openai/codex Codex CLI source
 * (codex-rs/login/src/server.rs, auth/manager.rs).
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { createHash, randomBytes }                        from 'crypto'
import { AddressInfo }                                    from 'net'
import { shell }                                          from 'electron'
import { log }                                            from './logger'

// ── Constants ─────────────────────────────────────────────────────────────────

/** OpenAI's official OAuth authorization endpoint */
export const OPENAI_AUTH_URL  = 'https://auth.openai.com/oauth/authorize'

/** OpenAI's token exchange endpoint */
export const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token'

/**
 * Public client ID — same one used by the OpenAI Codex CLI.
 * It is a public/native client (no client secret, PKCE only).
 */
export const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

/**
 * Base URL for ChatGPT Plus/Pro subscription endpoint.
 * When authenticated via OAuth, requests here draw from the user's
 * ChatGPT subscription quota rather than API pay-per-token credits.
 */
export const CHATGPT_CODEX_BASE = 'https://chatgpt.com/backend-api/codex'

/**
 * Fixed local callback port — must match the redirect URI registered
 * for the Codex CLI client at OpenAI's auth server.
 */
const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'

/** OAuth scopes required for ChatGPT subscription access (from Codex CLI source) */
const OPENAI_SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke'

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateVerifier(): string {
  // 64 random bytes → URL-safe base64 (no padding) — matches Codex CLI implementation
  return randomBytes(64).toString('base64url')
}
function generateChallenge(v: string): string {
  return createHash('sha256').update(v).digest('base64url')
}

// ── JWT decode helper ─────────────────────────────────────────────────────────

/** Safely decode a JWT payload (no signature verification needed here) */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  try {
    const parts = jwt.split('.')
    if (parts.length < 2) return {}
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json   = Buffer.from(padded, 'base64').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return {}
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OpenAIOAuthToken {
  accessToken:   string
  refreshToken?: string
  expiresAt?:    number   // Unix ms
  tokenType:     string
  email?:        string
  name?:         string
  planType?:     string   // 'free' | 'plus' | 'pro' | 'business' | 'enterprise'
  accountId?:    string   // chatgpt_account_id — required as ChatGPT-Account-ID header
}

// ── Login flow ────────────────────────────────────────────────────────────────

export function startOpenAILogin(): Promise<OpenAIOAuthToken> {
  return new Promise((resolve, reject) => {
    const verifier  = generateVerifier()
    const challenge = generateChallenge(verifier)
    const state     = randomBytes(32).toString('base64url')
    let   settled   = false

    const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      server.close()
      fn()
    }

    const timeout = setTimeout(() => {
      settle(() => reject(new Error('Login timeout: no response within 5 minutes.')))
    }, 5 * 60 * 1000)

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname !== CALLBACK_PATH) { res.writeHead(404); res.end(); return }

        const code     = url.searchParams.get('code')
        const retState = url.searchParams.get('state')
        const error    = url.searchParams.get('error')
        const errDesc  = url.searchParams.get('error_description') ?? ''

        const html = (ok: boolean, msg: string) => `<!DOCTYPE html><html><head><title>ChatUI · OpenAI</title>
          <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
          height:100vh;margin:0;background:#0d0d0d}
          .card{background:#1a1a1a;border:1px solid #333;border-radius:16px;padding:48px;max-width:380px;text-align:center}
          h2{margin:0 0 10px;font-size:22px;color:${ok ? '#4ade80' : '#f87171'}}
          p{margin:0;color:#9ca3af;font-size:14px;line-height:1.5}</style></head>
          <body><div class="card">
            <h2>${ok ? '&#10003; Signed in' : '&#10007; Failed'}</h2>
            <p>${msg}</p>
            ${ok ? '<p style="margin-top:14px;font-size:12px;color:#6b7280">You can close this tab.</p>' : ''}
          </div>
          <script>if(${ok})setTimeout(()=>window.close(),1500)</script>
          </body></html>`

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(html(false, errDesc || error))
          clearTimeout(timeout)
          settle(() => reject(new Error(`Login failed: ${errDesc || error}`)))
          return
        }
        if (retState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(html(false, 'Security check failed. Please try again.'))
          clearTimeout(timeout)
          settle(() => reject(new Error('OAuth state mismatch')))
          return
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(html(false, 'No authorization code received.'))
          clearTimeout(timeout)
          settle(() => reject(new Error('No authorization code in callback')))
          return
        }

        const body = new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  redirectUri,
          client_id:     OPENAI_CLIENT_ID,
          code_verifier: verifier,
        })

        const tokenRes = await fetch(OPENAI_TOKEN_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          body:    body.toString(),
        })

        if (!tokenRes.ok) {
          const text = await tokenRes.text()
          log.error('openai-auth', 'Token exchange failed', { status: tokenRes.status, body: text.slice(0, 200) })
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(html(false, `Sign-in failed (HTTP ${tokenRes.status}). Check the app logs for details.`))
          clearTimeout(timeout)
          settle(() => reject(new Error(`Token exchange failed: ${tokenRes.status}`)))
          return
        }

        const data = await tokenRes.json() as Record<string, unknown>

        // Extract email/name from id_token, plan type + account ID from access_token
        const idClaims     = data.id_token    ? decodeJwtPayload(String(data.id_token))    : {}
        const accessClaims = data.access_token ? decodeJwtPayload(String(data.access_token)) : {}
        const authNs       = (accessClaims['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>

        const email     = (idClaims.email    ?? accessClaims.email)    as string | undefined
        const name      = (idClaims.name     ?? idClaims.nickname)     as string | undefined
        const planType  = authNs.chatgpt_plan_type                     as string | undefined
        const accountId = authNs.chatgpt_account_id                    as string | undefined

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html(true, 'Signed in to OpenAI! Returning to ChatUI&#8230;'))
        clearTimeout(timeout)
        log.info('openai-auth', 'Login successful', { email, planType, accountId })
        settle(() => resolve({
          accessToken:  String(data.access_token),
          refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
          expiresAt:    typeof data.expires_in === 'number'
                          ? Date.now() + data.expires_in * 1000
                          : undefined,
          tokenType:    String(data.token_type ?? 'Bearer'),
          ...(email     ? { email }     : {}),
          ...(name      ? { name }      : {}),
          ...(planType  ? { planType }  : {}),
          ...(accountId ? { accountId } : {}),
        }))
      } catch (e) {
        log.error('openai-auth', 'Callback handler error', { error: String(e) })
        try { res.writeHead(500); res.end('Internal error') } catch { /* already sent */ }
        clearTimeout(timeout)
        settle(() => reject(e))
      }
    })

    // Bind on fixed port 1455 (matches registered redirect URI for this client_id)
    server.listen(CALLBACK_PORT, 'localhost', () => {
      const authUrl = new URL(OPENAI_AUTH_URL)
      authUrl.searchParams.set('response_type',              'code')
      authUrl.searchParams.set('client_id',                  OPENAI_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri',               redirectUri)
      authUrl.searchParams.set('scope',                      OPENAI_SCOPES)
      authUrl.searchParams.set('state',                      state)
      authUrl.searchParams.set('code_challenge',             challenge)
      authUrl.searchParams.set('code_challenge_method',      'S256')
      // Required extra params from Codex CLI source
      authUrl.searchParams.set('id_token_add_organizations', 'true')
      authUrl.searchParams.set('codex_cli_simplified_flow',  'true')
      authUrl.searchParams.set('originator',                 'codex_cli_rs')

      log.info('openai-auth', 'Opening browser for OpenAI login', {
        redirect: redirectUri,
        scopes:   OPENAI_SCOPES,
      })
      shell.openExternal(authUrl.toString())
    })

    server.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timeout)
      if (e.code === 'EADDRINUSE') {
        settle(() => reject(new Error(
          `Port ${CALLBACK_PORT} is already in use. ` +
          'Please close any other ChatUI or Codex CLI instances and try again.'
        )))
      } else {
        settle(() => reject(new Error(`Callback server error: ${String(e)}`)))
      }
    })
  })
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function refreshOpenAIToken(refreshToken: string): Promise<OpenAIOAuthToken> {
  // Refresh body sent as JSON (matches Codex CLI implementation)
  const res = await fetch(OPENAI_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     OPENAI_CLIENT_ID,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed: ${res.status} — ${text.slice(0, 200)}`)
  }

  const data = await res.json() as Record<string, unknown>

  // Re-parse email/name/plan/accountId from the new access token
  const idClaims     = data.id_token     ? decodeJwtPayload(String(data.id_token))     : {}
  const accessClaims = data.access_token ? decodeJwtPayload(String(data.access_token)) : {}
  const authNs       = (accessClaims['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>

  const email     = (idClaims.email   ?? accessClaims.email)  as string | undefined
  const name      = (idClaims.name    ?? idClaims.nickname)   as string | undefined
  const planType  = authNs.chatgpt_plan_type                  as string | undefined
  const accountId = authNs.chatgpt_account_id                 as string | undefined

  return {
    accessToken:  String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
    expiresAt:    typeof data.expires_in === 'number'
                    ? Date.now() + data.expires_in * 1000
                    : undefined,
    tokenType:    String(data.token_type ?? 'Bearer'),
    ...(email     ? { email }     : {}),
    ...(name      ? { name }      : {}),
    ...(planType  ? { planType }  : {}),
    ...(accountId ? { accountId } : {}),
  }
}

// ── Validity check ────────────────────────────────────────────────────────────

/** Returns true if the token exists and is not within 8 minutes of expiry. */
export function isOpenAITokenValid(token?: OpenAIOAuthToken | null): boolean {
  if (!token) return false
  if (!token.expiresAt) return true
  return Date.now() < token.expiresAt - 8 * 60_000
}
