import { useState, useCallback, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
type BodyType   = 'none' | 'json' | 'text' | 'form'
type ReqTab     = 'params' | 'headers' | 'body' | 'auth'
type ResTab     = 'body' | 'headers' | 'info'
type AuthType   = 'none' | 'bearer' | 'basic' | 'apikey'

interface KVRow { key: string; value: string; enabled: boolean }
interface SavedRequest {
  id:      string
  name:    string
  method:  HttpMethod
  url:     string
  params:  KVRow[]
  headers: KVRow[]
  bodyType: BodyType
  bodyText: string
  authType: AuthType
  authBearer: string
  authBasicUser: string
  authBasicPass: string
  authApiKeyName: string
  authApiKeyValue: string
  authApiKeyIn: 'header' | 'query'
}

interface Response {
  status:  number
  statusText: string
  headers: Record<string, string>
  body:    string
  ms:      number
  size:    number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2) }

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:     'text-green-600  dark:text-green-400',
  POST:    'text-blue-600   dark:text-blue-400',
  PUT:     'text-orange-500 dark:text-orange-400',
  PATCH:   'text-purple-600 dark:text-purple-400',
  DELETE:  'text-red-600    dark:text-red-400',
  HEAD:    'text-teal-600   dark:text-teal-400',
  OPTIONS: 'text-gray-500   dark:text-gray-400',
}

function statusColor(s: number) {
  if (s < 200) return 'text-gray-500'
  if (s < 300) return 'text-green-600 dark:text-green-400'
  if (s < 400) return 'text-blue-500  dark:text-blue-400'
  if (s < 500) return 'text-orange-500 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

function prettyJson(raw: string) {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function buildUrl(base: string, params: KVRow[]) {
  const active = params.filter(p => p.enabled && p.key.trim())
  if (!active.length) return base
  const qs = active.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
  return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`
}

// ── Sub-components ────────────────────────────────────────────────────────────
function KVEditor({
  rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value'
}: {
  rows: KVRow[]
  onChange: (rows: KVRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const set = (i: number, field: keyof KVRow, val: string | boolean) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r)
    onChange(next)
  }
  const add    = () => onChange([...rows, { key: '', value: '', enabled: true }])
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i))

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={e => set(i, 'enabled', e.target.checked)}
            className="flex-shrink-0 w-3.5 h-3.5 accent-blue-500"
          />
          <input
            value={row.key}
            onChange={e => set(i, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400"
          />
          <input
            value={row.value}
            onChange={e => set(i, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >×</button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="self-start mt-0.5 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
      >+ Add row</button>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void
  onAskAI?: (prompt: string) => void
}

export default function HttpBuilderPanel({ onClose, onAskAI }: Props) {
  // ── Request state ──────────────────────────────────────────────────────────
  const [method,    setMethod]    = useState<HttpMethod>('GET')
  const [url,       setUrl]       = useState('')
  const [reqTab,    setReqTab]    = useState<ReqTab>('params')
  const [params,    setParams]    = useState<KVRow[]>([])
  const [headers,   setHeaders]   = useState<KVRow[]>([])
  const [bodyType,  setBodyType]  = useState<BodyType>('none')
  const [bodyText,  setBodyText]  = useState('')
  const [authType,  setAuthType]  = useState<AuthType>('none')
  const [authBearer, setAuthBearer] = useState('')
  const [authBasicUser, setAuthBasicUser] = useState('')
  const [authBasicPass, setAuthBasicPass] = useState('')
  const [authApiKeyName,  setAuthApiKeyName]  = useState('X-API-Key')
  const [authApiKeyValue, setAuthApiKeyValue] = useState('')
  const [authApiKeyIn,    setAuthApiKeyIn]    = useState<'header' | 'query'>('header')

  // ── Response state ─────────────────────────────────────────────────────────
  const [response,  setResponse]  = useState<Response | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [resTab,    setResTab]    = useState<ResTab>('body')
  const [prettyMode, setPrettyMode] = useState(true)

  // ── Saved requests ─────────────────────────────────────────────────────────
  const [saved,      setSaved]      = useState<SavedRequest[]>([])
  const [savePanel,  setSavePanel]  = useState(false)
  const [saveName,   setSaveName]   = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // ── Send ───────────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setResponse(null)

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const finalUrl = buildUrl(url.trim(), params)

    // Build headers
    const reqHeaders: Record<string, string> = {}
    headers.filter(h => h.enabled && h.key.trim()).forEach(h => {
      reqHeaders[h.key.trim()] = h.value
    })

    // Auth injection
    if (authType === 'bearer' && authBearer) {
      reqHeaders['Authorization'] = `Bearer ${authBearer}`
    } else if (authType === 'basic' && authBasicUser) {
      reqHeaders['Authorization'] = `Basic ${btoa(`${authBasicUser}:${authBasicPass}`)}`
    } else if (authType === 'apikey' && authApiKeyValue) {
      if (authApiKeyIn === 'header') reqHeaders[authApiKeyName] = authApiKeyValue
    }

    // Body
    let body: BodyInit | undefined
    if (method !== 'GET' && method !== 'HEAD' && bodyType !== 'none') {
      if (bodyType === 'json') {
        reqHeaders['Content-Type'] = 'application/json'
        body = bodyText
      } else if (bodyType === 'text') {
        reqHeaders['Content-Type'] = 'text/plain'
        body = bodyText
      } else if (bodyType === 'form') {
        const fd = new FormData()
        bodyText.split('\n').forEach(line => {
          const [k, ...rest] = line.split('=')
          if (k?.trim()) fd.append(k.trim(), rest.join('=').trim())
        })
        body = fd
      }
    }

    const t0 = Date.now()
    try {
      const res = await fetch(finalUrl, {
        method,
        headers: reqHeaders,
        body,
        signal: abortRef.current.signal,
        credentials: 'omit',
      })

      const resBody = await res.text()
      const resHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { resHeaders[k] = v })

      setResponse({
        status:     res.status,
        statusText: res.statusText,
        headers:    resHeaders,
        body:       resBody,
        ms:         Date.now() - t0,
        size:       new TextEncoder().encode(resBody).length,
      })
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        setError((err as Error)?.message ?? 'Request failed')
      }
    } finally {
      setLoading(false)
    }
  }, [url, method, params, headers, bodyType, bodyText, authType, authBearer,
      authBasicUser, authBasicPass, authApiKeyName, authApiKeyValue, authApiKeyIn])

  const saveRequest = () => {
    if (!saveName.trim()) return
    const req: SavedRequest = {
      id: genId(), name: saveName.trim(), method, url, params, headers,
      bodyType, bodyText, authType, authBearer, authBasicUser, authBasicPass,
      authApiKeyName, authApiKeyValue, authApiKeyIn,
    }
    setSaved(s => [...s, req])
    setSaveName('')
    setSavePanel(false)
  }

  const loadRequest = (req: SavedRequest) => {
    setMethod(req.method); setUrl(req.url); setParams(req.params)
    setHeaders(req.headers); setBodyType(req.bodyType); setBodyText(req.bodyText)
    setAuthType(req.authType); setAuthBearer(req.authBearer)
    setAuthBasicUser(req.authBasicUser); setAuthBasicPass(req.authBasicPass)
    setAuthApiKeyName(req.authApiKeyName); setAuthApiKeyValue(req.authApiKeyValue)
    setAuthApiKeyIn(req.authApiKeyIn)
  }

  const inputCls = 'px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400 transition-colors'

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* ── Title bar ─────────────────────────────────────────────────────��─ */}
      <div
        className="h-9 flex items-center px-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <span>🌐</span> HTTP Builder
        </span>
        <div className="flex items-center gap-1 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {onAskAI && response && (
            <button
              type="button"
              onClick={() => {
                const prompt = `I made an HTTP request:\n${method} ${url}\n\nStatus: ${response.status} ${response.statusText}\n\nResponse body:\n${response.body.slice(0, 2000)}\n\nCan you help me understand or process this response?`
                onAskAI(prompt)
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-purple-600 hover:bg-purple-500 text-white transition-colors"
            >
              Ask AI
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Saved requests ────────────────────────────────────────── */}
        {saved.length > 0 && (
          <div className="w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto py-2">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">Saved</p>
            {saved.map(req => (
              <button
                key={req.id}
                type="button"
                onClick={() => loadRequest(req)}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 group"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-bold ${METHOD_COLORS[req.method]}`}>{req.method}</span>
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{req.name}</span>
                </div>
                <p className="text-[10px] text-gray-400 truncate">{req.url}</p>
              </button>
            ))}
          </div>
        )}

        {/* ── Right: main content ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* URL bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <select
              value={method}
              onChange={e => setMethod(e.target.value as HttpMethod)}
              className={`w-28 flex-shrink-0 font-semibold text-sm ${METHOD_COLORS[method]} ${inputCls}`}
            >
              {(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'] as HttpMethod[]).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="https://api.example.com/endpoint"
              className={`flex-1 min-w-0 font-mono text-sm ${inputCls}`}
            />
            <button
              type="button"
              onClick={send}
              disabled={loading || !url.trim()}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {loading ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
              {loading ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={() => setSavePanel(true)}
              title="Save request"
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-8H7v8M7 3v5h8"/>
              </svg>
            </button>
          </div>

          {/* Save panel */}
          {savePanel && (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
              <input
                autoFocus
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveRequest(); if (e.key === 'Escape') setSavePanel(false) }}
                placeholder="Request name…"
                className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 outline-none"
              />
              <button type="button" onClick={saveRequest} className="px-2.5 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-500">Save</button>
              <button type="button" onClick={() => setSavePanel(false)} className="px-2.5 py-1 rounded text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          )}

          {/* Content: request tabs + response */}
          <div className="flex flex-1 overflow-hidden">
            {/* Request tabs */}
            <div className="w-1/2 flex flex-col border-r border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                {(['params','headers','body','auth'] as ReqTab[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setReqTab(t)}
                    className={`px-3.5 py-2 text-xs font-medium capitalize transition-colors
                      ${reqTab === t
                        ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                  >{t}</button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {reqTab === 'params' && (
                  <KVEditor rows={params} onChange={setParams} keyPlaceholder="param" valuePlaceholder="value" />
                )}

                {reqTab === 'headers' && (
                  <KVEditor rows={headers} onChange={setHeaders} keyPlaceholder="Header" valuePlaceholder="Value" />
                )}

                {reqTab === 'body' && (
                  <div>
                    <div className="flex gap-2 mb-3">
                      {(['none','json','text','form'] as BodyType[]).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setBodyType(t)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            bodyType === t
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >{t}</button>
                      ))}
                    </div>
                    {bodyType !== 'none' && (
                      <textarea
                        value={bodyText}
                        onChange={e => setBodyText(e.target.value)}
                        rows={12}
                        spellCheck={false}
                        placeholder={
                          bodyType === 'json'
                            ? '{\n  "key": "value"\n}'
                            : bodyType === 'form'
                            ? 'key=value\nkey2=value2'
                            : 'Request body…'
                        }
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400 resize-y"
                      />
                    )}
                    {bodyType === 'none' && (
                      <p className="text-xs text-gray-400 italic">This request has no body.</p>
                    )}
                  </div>
                )}

                {reqTab === 'auth' && (
                  <div>
                    <div className="flex gap-2 mb-4">
                      {(['none','bearer','basic','apikey'] as AuthType[]).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setAuthType(t)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            authType === t
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >{t === 'apikey' ? 'API Key' : t}</button>
                      ))}
                    </div>
                    {authType === 'bearer' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Token</label>
                        <input
                          type="password"
                          value={authBearer}
                          onChange={e => setAuthBearer(e.target.value)}
                          placeholder="Bearer token…"
                          className={`w-full ${inputCls} font-mono text-xs`}
                        />
                      </div>
                    )}
                    {authType === 'basic' && (
                      <div className="flex flex-col gap-2">
                        <input
                          value={authBasicUser}
                          onChange={e => setAuthBasicUser(e.target.value)}
                          placeholder="Username"
                          className={`w-full ${inputCls}`}
                        />
                        <input
                          type="password"
                          value={authBasicPass}
                          onChange={e => setAuthBasicPass(e.target.value)}
                          placeholder="Password"
                          className={`w-full ${inputCls}`}
                        />
                      </div>
                    )}
                    {authType === 'apikey' && (
                      <div className="flex flex-col gap-2">
                        <input
                          value={authApiKeyName}
                          onChange={e => setAuthApiKeyName(e.target.value)}
                          placeholder="Header/param name"
                          className={`w-full ${inputCls}`}
                        />
                        <input
                          type="password"
                          value={authApiKeyValue}
                          onChange={e => setAuthApiKeyValue(e.target.value)}
                          placeholder="Value"
                          className={`w-full ${inputCls} font-mono text-xs`}
                        />
                        <div className="flex gap-2">
                          {(['header','query'] as const).map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setAuthApiKeyIn(t)}
                              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${authApiKeyIn === t ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                            >In {t}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {authType === 'none' && (
                      <p className="text-xs text-gray-400 italic">No authentication.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Response */}
            <div className="w-1/2 flex flex-col overflow-hidden">
              {error && (
                <div className="m-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                  ✕ {error}
                </div>
              )}

              {!response && !error && !loading && (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3">
                  <svg className="w-10 h-10 text-gray-200 dark:text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                  <p className="text-sm text-gray-400">Hit Send to see the response</p>
                </div>
              )}

              {loading && (
                <div className="flex-1 flex items-center justify-center gap-2 text-sm text-gray-400">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Waiting for response…
                </div>
              )}

              {response && (
                <>
                  {/* Response status bar */}
                  <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                    <span className={`text-sm font-bold ${statusColor(response.status)}`}>
                      {response.status} {response.statusText}
                    </span>
                    <span className="text-xs text-gray-400">{response.ms} ms</span>
                    <span className="text-xs text-gray-400">{(response.size / 1024).toFixed(1)} KB</span>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPrettyMode(p => !p)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                          prettyMode
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >Pretty</button>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(response.body)}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >Copy</button>
                    </div>
                  </div>

                  {/* Response tabs */}
                  <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                    {(['body','headers','info'] as ResTab[]).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setResTab(t)}
                        className={`px-3.5 py-2 text-xs font-medium capitalize transition-colors
                          ${resTab === t
                            ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                          }`}
                      >{t}</button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    {resTab === 'body' && (
                      <pre className="p-4 text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                        {prettyMode ? prettyJson(response.body) : response.body}
                      </pre>
                    )}
                    {resTab === 'headers' && (
                      <div className="p-4">
                        {Object.entries(response.headers).map(([k, v]) => (
                          <div key={k} className="flex gap-2 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
                            <span className="text-xs font-mono text-blue-600 dark:text-blue-400 flex-shrink-0 min-w-0">{k}</span>
                            <span className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {resTab === 'info' && (
                      <div className="p-4 flex flex-col gap-3 text-xs">
                        <div>
                          <p className="font-medium text-gray-500 dark:text-gray-400 mb-1">URL</p>
                          <p className="font-mono text-gray-800 dark:text-gray-200 break-all">{buildUrl(url, params)}</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500 dark:text-gray-400 mb-1">Method</p>
                          <p className={`font-bold ${METHOD_COLORS[method]}`}>{method}</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500 dark:text-gray-400 mb-1">Response time</p>
                          <p className="text-gray-800 dark:text-gray-200">{response.ms} ms</p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-500 dark:text-gray-400 mb-1">Response size</p>
                          <p className="text-gray-800 dark:text-gray-200">{response.size} bytes ({(response.size / 1024).toFixed(2)} KB)</p>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
