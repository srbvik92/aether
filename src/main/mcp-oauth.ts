/**
 * MCP OAuth — OAuth 2.0 Authorization Code + PKCE flow for remote MCP servers.
 *
 * RFC 8252 (OAuth 2.0 for Native Apps): uses a local loopback HTTP server as
 * the redirect_uri so the browser can hand the code back to the desktop app
 * without registering a custom URI scheme.
 *
 * Flow:
 *   1. Generate code_verifier + code_challenge (S256)
 *   2. Start local HTTP server on a random port → redirect_uri = http://127.0.0.1:PORT/callback
 *   3. Open browser at authorizationUrl with PKCE params
 *   4. User consents → browser redirected to localhost → server captures code
 *   5. Exchange code for tokens (POST tokenUrl)
 *   6. Return { accessToken, refreshToken, expiresAt }
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { createHash, randomBytes }                        from 'crypto'
import { AddressInfo }                                    from 'net'
import { shell }                                          from 'electron'
import { log }                                            from './logger'

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function generateVerifier(): string {
  // 32 bytes → 43-char base64url (within the 43–128 range required by PKCE)
  return randomBytes(32).toString('base64url')
}

function generateChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OAuthStartOptions {
  authorizationUrl: string
  tokenUrl:         string
  clientId:         string
  clientSecret?:    string   // optional — PKCE-only flows don't need it
  scopes:           string   // space-separated, e.g. "read write"
}

export interface OAuthTokenSet {
  accessToken:   string
  refreshToken?: string
  expiresAt?:    number   // Unix ms — undefined means non-expiring
  tokenType:     string   // usually 'Bearer'
  scope?:        string
}

// ── Main OAuth flow ───────────────────────────────────────────────────────────

export function startOAuthFlow(opts: OAuthStartOptions): Promise<OAuthTokenSet> {
  return new Promise((resolve, reject) => {
    const verifier   = generateVerifier()
    const challenge  = generateChallenge(verifier)
    const state      = randomBytes(16).toString('hex')
    let   settled    = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      server.close()
      fn()
    }

    // 5-minute hard timeout
    const timeout = setTimeout(() => {
      settle(() => reject(new Error('OAuth timeout: no response within 5 minutes. Please try again.')))
    }, 5 * 60 * 1000)

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url   = new URL(req.url ?? '/', `http://127.0.0.1`)
        if (url.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return }

        const code          = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const error         = url.searchParams.get('error')
        const errorDesc     = url.searchParams.get('error_description') ?? ''

        // Always send a friendly HTML page back to the browser
        const html = (ok: boolean, msg: string) => `
          <!DOCTYPE html><html><head><title>ChatUI OAuth</title>
          <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
          .card{background:#fff;border-radius:12px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:360px;text-align:center}
          h2{margin:0 0 8px;font-size:22px;color:${ok?'#16a34a':'#dc2626'}}p{margin:0;color:#6b7280;font-size:14px}</style></head>
          <body><div class="card"><h2>${ok?'✅ Connected':'❌ Failed'}</h2><p>${msg}</p>${ok?'<p style="margin-top:12px;font-size:12px">You can close this tab.</p>':''}</div>
          <script>if(${ok})setTimeout(()=>window.close(),1500)</script></body></html>`

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(html(false, errorDesc || error))
          clearTimeout(timeout)
          settle(() => reject(new Error(`Authorization failed: ${errorDesc || error}`)))
          return
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(html(false, 'Security check failed (state mismatch). Please try again.'))
          clearTimeout(timeout)
          settle(() => reject(new Error('OAuth state mismatch — possible CSRF attempt')))
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(html(false, 'No authorization code received.'))
          clearTimeout(timeout)
          settle(() => reject(new Error('No authorization code in callback')))
          return
        }

        // Exchange code for tokens
        const port       = (server.address() as AddressInfo).port
        const redirectUri = `http://127.0.0.1:${port}/callback`

        const body = new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  redirectUri,
          client_id:     opts.clientId,
          code_verifier: verifier,
          ...(opts.clientSecret ? { client_secret: opts.clientSecret } : {})
        })

        const tokenRes = await fetch(opts.tokenUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          body:    body.toString()
        })

        if (!tokenRes.ok) {
          const text = await tokenRes.text()
          log.error('mcp-oauth', 'Token exchange failed', { status: tokenRes.status, body: text.slice(0, 200) })
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(html(false, `Token exchange failed (${tokenRes.status}). Check your OAuth credentials.`))
          clearTimeout(timeout)
          settle(() => reject(new Error(`Token exchange failed: ${tokenRes.status}`)))
          return
        }

        const data = await tokenRes.json() as Record<string, unknown>
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html(true, 'Authorization successful! Returning to ChatUI…'))
        clearTimeout(timeout)
        settle(() => resolve({
          accessToken:   String(data.access_token),
          refreshToken:  data.refresh_token ? String(data.refresh_token) : undefined,
          expiresAt:     typeof data.expires_in === 'number'
                           ? Date.now() + data.expires_in * 1000
                           : undefined,
          tokenType:     String(data.token_type ?? 'Bearer'),
          scope:         data.scope ? String(data.scope) : undefined,
        }))

      } catch (e) {
        log.error('mcp-oauth', 'Callback handler error', { error: String(e) })
        try { res.writeHead(500); res.end('Internal error') } catch { /* already sent */ }
        clearTimeout(timeout)
        settle(() => reject(e))
      }
    })

    // Start listening on a random port
    server.listen(0, '127.0.0.1', () => {
      const port       = (server.address() as AddressInfo).port
      const redirectUri = `http://127.0.0.1:${port}/callback`

      const authUrl = new URL(opts.authorizationUrl)
      authUrl.searchParams.set('response_type',          'code')
      authUrl.searchParams.set('client_id',              opts.clientId)
      authUrl.searchParams.set('redirect_uri',           redirectUri)
      authUrl.searchParams.set('scope',                  opts.scopes)
      authUrl.searchParams.set('state',                  state)
      authUrl.searchParams.set('code_challenge',         challenge)
      authUrl.searchParams.set('code_challenge_method',  'S256')

      log.info('mcp-oauth', 'Opening browser for OAuth', { url: authUrl.toString().slice(0, 80) + '…' })
      shell.openExternal(authUrl.toString())
    })

    server.on('error', (e) => {
      clearTimeout(timeout)
      settle(() => reject(new Error(`OAuth callback server error: ${String(e)}`)))
    })
  })
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function refreshOAuthToken(opts: {
  tokenUrl:      string
  clientId:      string
  clientSecret?: string
  refreshToken:  string
}): Promise<OAuthTokenSet> {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: opts.refreshToken,
    client_id:     opts.clientId,
    ...(opts.clientSecret ? { client_secret: opts.clientSecret } : {})
  })

  const res = await fetch(opts.tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body:    body.toString()
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed: ${res.status} — ${text.slice(0, 200)}`)
  }

  const data = await res.json() as Record<string, unknown>
  return {
    accessToken:  String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : opts.refreshToken,
    expiresAt:    typeof data.expires_in === 'number'
                    ? Date.now() + data.expires_in * 1000
                    : undefined,
    tokenType:    String(data.token_type ?? 'Bearer'),
    scope:        data.scope ? String(data.scope) : undefined,
  }
}

// ── Token validity check ──────────────────────────────────────────────────────

/** Returns true if the token is valid and not within 60 seconds of expiry. */
export function isTokenValid(expiresAt?: number): boolean {
  if (!expiresAt) return true   // no expiry = treat as valid
  return Date.now() < expiresAt - 60_000
}
