import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import {
  AppSettings,
  Provider,
  CustomProviderConfig,
  PROVIDER_MODELS,
  PROVIDER_BASE_URLS,
  VERTEX_LOCATIONS,
  SemanticIndexInfo,
  SemanticIndexStatusPayload,
  DEFAULT_SETTINGS
} from '../../../shared/types'
import { useSemanticIndex } from '../hooks/useSemanticIndex'
import type { SemanticSearchResult } from '../../../shared/types'
import { PROMPT_TEMPLATES, findMatchingTemplate } from '../utils/promptTemplates'
import { validateSettings, ValidationResult, hasErrors } from '../utils/settingsValidator'
const McpServersPanel = lazy(() => import('./McpServersPanel'))

interface Props {
  settings: AppSettings
  onSave: (settings: AppSettings) => void
  onCancel: () => void
}

// ── Template dropdown (used inside Settings) ──────────────────────────────────
function TemplateDropdown({
  currentPrompt, onSelect
}: { currentPrompt: string; onSelect: (prompt: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref             = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700
                   text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400
                   hover:border-blue-300 dark:hover:border-blue-600 transition-colors bg-white dark:bg-gray-900"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
        Templates
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Quick-start templates
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {PROMPT_TEMPLATES.map(t => {
              const active = t.prompt.trim() === currentPrompt.trim()
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { onSelect(t.prompt); setOpen(false) }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                    active ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <span className="text-lg leading-none mt-0.5">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                      {t.name}
                      {active && <span className="ml-1.5 text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-semibold">Active</span>}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function OllamaDetector({ onModelSelect }: { onModelSelect: (model: string) => void }) {
  const [models,   setModels]   = useState<string[]>([])
  const [loading,  setLoading]  = useState(false)
  const [detected, setDetected] = useState(false)

  const detect = async () => {
    if (!window.api) return
    setLoading(true)
    const result = await window.api.listOllamaModels()
    setLoading(false)
    setDetected(true)
    if (result.ok) setModels(result.models)
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={detect}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          {loading ? 'Detecting…' : 'Detect Ollama models'}
        </button>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">Looks for Ollama at localhost:11434</span>
      </div>
      {detected && models.length === 0 && (
        <div className="mt-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-2.5">
          <p className="text-xs text-orange-700 dark:text-orange-300 font-medium">No Ollama models found</p>
          <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-0.5">Make sure Ollama is running, then pull a model:</p>
          <div className="mt-1.5 flex flex-col gap-1">
            {[
              { cmd: 'ollama pull llama3.2',         note: '2 GB — fast, great for chat' },
              { cmd: 'ollama pull qwen2.5-coder:7b', note: '4 GB — best for coding' },
              { cmd: 'ollama pull deepseek-r1:8b',   note: '5 GB — reasoning model' },
            ].map(({ cmd, note }) => (
              <div key={cmd} className="flex items-center justify-between gap-2">
                <code className="text-[10px] font-mono text-orange-800 dark:text-orange-200 bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 rounded">
                  {cmd}
                </code>
                <span className="text-[10px] text-orange-500 dark:text-orange-400 whitespace-nowrap">{note}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {models.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {models.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => onModelSelect(m)}
              className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[11px] text-gray-700 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-mono"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Custom Provider Manager ───────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

interface CustomProviderManagerProps {
  providers:   CustomProviderConfig[]
  activeId:    string | undefined
  onProviders: (providers: CustomProviderConfig[]) => void
  onSelect:    (p: CustomProviderConfig) => void
  inputCls:    string
  labelCls:    string
  hintCls:     string
}

function CustomProviderManager({
  providers, activeId, onProviders, onSelect, inputCls, labelCls, hintCls
}: CustomProviderManagerProps) {
  const emptyDraft = { id: '', name: '', baseUrl: '', apiKey: '', model: '' }
  const [editing, setEditing] = useState<CustomProviderConfig | null>(null)
  const [draft,   setDraft]   = useState(emptyDraft)

  const openNew  = () => {
    const newId = genId()
    setEditing({ id: newId, name: '', baseUrl: '', apiKey: '', model: '' })
    setDraft({ id: newId, name: '', baseUrl: '', apiKey: '', model: '' })
  }
  const openEdit = (p: CustomProviderConfig) => { setEditing(p); setDraft(p) }
  const cancel   = () => { setEditing(null); setDraft(emptyDraft) }

  const save = () => {
    if (!draft.name.trim() || !draft.baseUrl.trim()) return
    const entry: CustomProviderConfig = { ...draft, id: editing!.id }
    const exists = providers.find(p => p.id === entry.id)
    const updated = exists
      ? providers.map(p => p.id === entry.id ? entry : p)
      : [...providers, entry]
    onProviders(updated)
    cancel()
  }

  const remove = (id: string) => {
    onProviders(providers.filter(p => p.id !== id))
  }

  return (
    <div className="space-y-3">
      {/* Saved providers list */}
      {providers.length === 0 && !editing && (
        <p className="text-xs text-gray-400 dark:text-gray-600 italic py-1">No custom providers saved yet.</p>
      )}
      {providers.map(p => (
        <div
          key={p.id}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
            activeId === p.id
              ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-600 truncate">{p.baseUrl} · {p.model || 'no default model'}</p>
          </div>
          <button
            onClick={() => onSelect(p)}
            className={`flex-shrink-0 text-xs px-2 py-1 rounded-md font-medium transition-colors ${
              activeId === p.id
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400'
            }`}
            title="Use this provider"
          >
            {activeId === p.id ? '✓ Active' : 'Use'}
          </button>
          <button
            onClick={() => openEdit(p)}
            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Edit"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
          </button>
          <button
            onClick={() => remove(p.id)}
            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}

      {/* Add/Edit form */}
      {editing ? (
        <div className="border border-blue-300 dark:border-blue-700 rounded-lg p-3 space-y-2.5 bg-blue-50/40 dark:bg-blue-900/10">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
            {providers.find(p => p.id === editing.id) ? 'Edit provider' : 'New provider'}
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={draft.name}
              onChange={e => setDraft(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Ollama local, LM Studio, My Server"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Base URL <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={draft.baseUrl}
              onChange={e => setDraft(f => ({ ...f, baseUrl: e.target.value }))}
              placeholder="http://localhost:11434/v1"
              className={inputCls}
            />
            <p className={hintCls}>Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">API Key <span className="text-gray-400 font-normal">(leave blank for local)</span></label>
            <input
              type="password"
              value={draft.apiKey}
              onChange={e => setDraft(f => ({ ...f, apiKey: e.target.value }))}
              placeholder="sk-... or leave blank"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Default Model</label>
            <input
              type="text"
              value={draft.model}
              onChange={e => setDraft(f => ({ ...f, model: e.target.value }))}
              placeholder="e.g. llama3.2, mistral, phi3, qwen2.5-coder"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={!draft.name.trim() || !draft.baseUrl.trim()}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save provider
            </button>
            <button
              onClick={cancel}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={openNew}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add provider
        </button>
      )}
    </div>
  )
}

// ── Nav items for the left sidebar ───────────────────────────────────────────
type SettingsSection = 'general' | 'models' | 'prompt' | 'workspace' | 'mcp' | 'integrations' | 'features' | 'advanced'

const NAV_ITEMS: { id: SettingsSection; icon: string; label: string }[] = [
  { id: 'general',      icon: '⚙️',  label: 'General' },
  { id: 'models',       icon: '🤖',  label: 'Models' },
  { id: 'prompt',       icon: '💬',  label: 'System Prompt' },
  { id: 'workspace',    icon: '📁',  label: 'Workspace' },
  { id: 'mcp',          icon: '🔌',  label: 'MCP Servers' },
  { id: 'integrations', icon: '🔗',  label: 'Integrations' },
  { id: 'features',     icon: '🧩',  label: 'Features' },
  { id: 'advanced',     icon: '🔧',  label: 'Advanced' },
]

export default function Settings({ settings, onSave, onCancel }: Props) {
  const [form, setForm] = useState<AppSettings>({ ...settings })
  const originalSettings = useRef<AppSettings>({ ...settings })
  const [hasChanges, setHasChanges] = useState(false)

  // ── OpenAI dynamic model list ─────────────────────────────────────────────
  const [openAIModels, setOpenAIModels]   = useState<string[]>([])
  const [openAILoading, setOpenAILoading] = useState(false)
  const openAIFetchedRef                  = useRef(false)

  const fetchOpenAIModels = useCallback(async (apiKey: string) => {
    if (!apiKey?.trim() || openAIFetchedRef.current) return
    openAIFetchedRef.current = true
    setOpenAILoading(true)
    try {
      const result = await window.api.getOpenAIModels(apiKey)
      if (result.ok && result.models.length > 0) {
        setOpenAIModels(result.models)
      } else {
        openAIFetchedRef.current = false  // allow retry
      }
    } catch {
      openAIFetchedRef.current = false
    } finally {
      setOpenAILoading(false)
    }
  }, [])

  // Auto-fetch when provider switches to openai — use API key if set, OAuth token as fallback
  useEffect(() => {
    if (form.provider === 'openai') {
      const key = form.apiKey?.trim() || form.openaiOAuth?.accessToken
      if (key) fetchOpenAIModels(key)
    }
  }, [form.provider, form.apiKey, form.openaiOAuth?.accessToken, fetchOpenAIModels])

  // ── OpenRouter dynamic model list ────────────────────────────────────────
  const [orModels, setOrModels]     = useState<Array<{ id: string; name: string; isFree: boolean }>>([])
  const [orLoading, setOrLoading]   = useState(false)
  const orFetchedRef                = useRef(false)

  const fetchOrModels = useCallback(async (apiKey?: string) => {
    if (orFetchedRef.current) return
    orFetchedRef.current = true
    setOrLoading(true)
    try {
      const result = await window.api.getOpenRouterModels(apiKey)
      if (result.ok && result.models.length > 0) {
        setOrModels(result.models)
      } else {
        orFetchedRef.current = false  // allow retry
      }
    } catch {
      orFetchedRef.current = false
    } finally {
      setOrLoading(false)
    }
  }, [])

  // Auto-fetch when provider is openrouter
  useEffect(() => {
    if (form.provider === 'openrouter') {
      fetchOrModels(form.apiKey || undefined)
    }
  }, [form.provider, fetchOrModels])
  const [importExportMsg, setImportExportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [showSA, setShowSA] = useState(false)
  const [saFileName, setSaFileName] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationResult[]>([])
  const [selectedSection, setSelectedSection] = useState<SettingsSection>('general')

  // ── OpenAI OAuth state ───────────────────────────────────────────────────
  const [oauthLoading,  setOauthLoading]  = useState(false)
  const [oauthError,    setOauthError]    = useState<string | null>(null)

  const handleOpenAILogin = async () => {
    setOauthLoading(true); setOauthError(null)
    try {
      const result = await window.api.loginWithOpenAI()
      if (result.ok && result.token) {
        const updated = { ...form, openaiOAuth: result.token }
        setForm(updated)
        // Auto-save immediately so ChatWindow sees the token without
        // requiring the user to manually click Save first
        await window.api.saveSettings(updated)
        onSave(updated)
      } else {
        setOauthError(result.error ?? 'Sign-in failed')
      }
    } catch (e) { setOauthError(String(e)) }
    finally { setOauthLoading(false) }
  }

  const handleOpenAIRefresh = async () => {
    const rt = form.openaiOAuth?.refreshToken
    if (!rt) return
    setOauthLoading(true); setOauthError(null)
    try {
      const result = await window.api.refreshOpenAIToken(rt)
      if (result.ok && result.token) {
        setForm(f => ({ ...f, openaiOAuth: { ...f.openaiOAuth!, ...result.token! } }))
      } else {
        const raw = result.error ?? 'Refresh failed'
        // Detect permanent token invalidation (one-time-use refresh tokens).
        // In this case the refresh token is dead — clear it so the UI switches
        // to the "expired / sign in again" state cleanly.
        const isTerminal = /already been used|invalid_request_error|invalid_grant|token.*expired/i.test(raw)
        if (isTerminal) {
          setForm(f => ({ ...f, openaiOAuth: f.openaiOAuth
            ? { ...f.openaiOAuth, refreshToken: undefined, expiresAt: Date.now() - 1 }
            : undefined
          }))
          setOauthError('Session expired — please sign in again.')
        } else {
          setOauthError(raw)
        }
      }
    } catch (e) { setOauthError(String(e)) }
    finally { setOauthLoading(false) }
  }

  const handleOpenAILogout = async () => {
    await window.api.logoutOpenAI()
    setForm(f => ({ ...f, openaiOAuth: undefined }))
  }

  const oauthToken    = form.openaiOAuth
  const oauthValid    = oauthToken && (!oauthToken.expiresAt || oauthToken.expiresAt > Date.now() + 60_000)
  const oauthExpired  = oauthToken && oauthToken.expiresAt && oauthToken.expiresAt <= Date.now() + 60_000

  function formatOAuthExpiry(expiresAt?: number): string {
    if (!expiresAt) return 'Non-expiring'
    const diff  = expiresAt - Date.now()
    if (diff <= 0) return 'Expired'
    const mins  = Math.floor(diff / 60_000)
    const hours = Math.floor(mins / 60)
    if (hours > 0) return `Expires in ${hours}h ${mins % 60}m`
    return `Expires in ${mins}m`
  }

  const handleSave = () => {
    const results = validateSettings(form)
    setValidationErrors(results)
    if (hasErrors(results)) return  // Block save on errors
    originalSettings.current = { ...form }
    setHasChanges(false)
    onSave(form)
  }

  const handleRevert = () => {
    setForm({ ...originalSettings.current })
    setHasChanges(false)
    setValidationErrors([])
  }

  const handleExportSettings = async () => {
    if (!window.api) return
    const result = await window.api.exportSettings()
    setImportExportMsg(result.ok
      ? { ok: true, text: 'Settings exported successfully.' }
      : { ok: false, text: result.error ?? 'Export failed.' }
    )
    setTimeout(() => setImportExportMsg(null), 3000)
  }

  const handleImportSettings = async () => {
    if (!window.api) return
    const result = await window.api.importSettings()
    if (result.ok && result.settings) {
      setForm(result.settings)
      setImportExportMsg({ ok: true, text: 'Settings imported. Click Save to apply.' })
      setTimeout(() => setImportExportMsg(null), 4000)
    } else if (!result.ok && result.error) {
      setImportExportMsg({ ok: false, text: result.error })
      setTimeout(() => setImportExportMsg(null), 3000)
    }
  }

  // ── Semantic index state ───────────────────────────────────────────────────
  const [bm25Info, setBm25Info]           = useState<SemanticIndexInfo | null>(null)
  const [bm25Status, setBm25Status]       = useState<SemanticIndexStatusPayload | null>(null)
  const [bm25Building, setBm25Building]   = useState(false)
  const [searchQuery, setSearchQuery]     = useState('')
  const [searchResults, setSearchResults] = useState<SemanticSearchResult[]>([])
  const [searching, setSearching]         = useState(false)

  const { state: embedState, buildIndex: buildEmbedIndex, search: embedSearch } =
    useSemanticIndex(form.workspacePath)

  // Load BM25 index info when workspace changes
  useEffect(() => {
    if (!form.workspacePath || !window.api) return
    window.api.getSemanticIndexInfo(form.workspacePath).then(setBm25Info).catch(() => {})
    window.api.onSemanticIndexStatus(setBm25Status)
    return () => window.api.removeSemanticListeners()
  }, [form.workspacePath])

  // Refresh info after build completes
  useEffect(() => {
    if (bm25Status?.phase === 'done' && form.workspacePath) {
      setBm25Building(false)
      window.api.getSemanticIndexInfo(form.workspacePath).then(setBm25Info).catch(() => {})
    }
    if (bm25Status?.phase === 'error') setBm25Building(false)
  }, [bm25Status])

  const handleBuildBm25 = useCallback(async () => {
    if (!form.workspacePath) return
    setBm25Building(true)
    setBm25Status({ phase: 'scanning', done: 0, total: 0, message: 'Scanning files…' })
    await window.api.buildSemanticIndex(form.workspacePath)
  }, [form.workspacePath])

  const handleSemanticSearch = useCallback(async () => {
    if (!searchQuery.trim() || !form.workspacePath) return
    setSearching(true)
    try {
      const results = await embedSearch(searchQuery, 5)
      setSearchResults(results)
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [searchQuery, embedSearch, form.workspacePath])

  const handleProviderChange = (provider: Provider) => {
    const models = PROVIDER_MODELS[provider]
    setForm((prev) => ({
      ...prev,
      provider,
      baseUrl: PROVIDER_BASE_URLS[provider],
      model: models.length > 0 ? models[0] : prev.model,
      // Keep selectedCustomProviderId only when switching to 'custom'
      selectedCustomProviderId: provider === 'custom' ? prev.selectedCustomProviderId : undefined
    }))
    setHasChanges(true)
    setTestResult(null)
  }

  const handleSelectCustomProvider = (p: import('../../../shared/types').CustomProviderConfig) => {
    setForm(prev => ({
      ...prev,
      provider: 'custom',
      baseUrl:  p.baseUrl,
      apiKey:   p.apiKey || prev.apiKey,
      model:    p.model,
      selectedCustomProviderId: p.id
    }))
    setHasChanges(true)
  }

  const handleCustomProvidersChange = (updated: import('../../../shared/types').CustomProviderConfig[]) => {
    setForm(prev => ({ ...prev, customProviders: updated }))
    setHasChanges(true)
  }

  // Track whether form has diverged from saved settings
  useEffect(() => {
    const changed = JSON.stringify(form) !== JSON.stringify(originalSettings.current)
    setHasChanges(changed)
  }, [form])

  const isGemini     = form.provider === 'gemini'
  const isCustom     = form.provider === 'custom'
  const isNvidia     = form.provider === 'nvidia'
  const isOpenRouter = form.provider === 'openrouter'
  const isOpenAI     = form.provider === 'openai'
  const needsApiKey  = !isGemini

  // Max output tokens per model (the slider ceiling)
  const MAX_OUTPUT_TOKENS: Record<string, number> = {
    // Anthropic — 32K output for claude-3.x+
    'claude-opus-4-6':   32_768,
    'claude-sonnet-4-6': 32_768,
    'claude-haiku-4-5':  32_768,
    // OpenAI
    'gpt-4o':            16_384,
    'gpt-4o-mini':       16_384,
    'gpt-4-turbo':       16_384,
    'gpt-3.5-turbo':      4_096,
    // Gemini
    'gemini-3.1-pro-preview':          65_536,
    'gemini-2.5-pro-preview-05-06':   65_536,
    'gemini-2.5-flash-preview-04-17': 65_536,
    'gemini-2.0-flash-001':           8_192,
    'gemini-2.0-flash-lite-001':      8_192,
    'gemini-1.5-pro-002':             8_192,
    'gemini-1.5-flash-002':           8_192,
  }
  const maxOutputCeiling = MAX_OUTPUT_TOKENS[form.model] ?? 32_768
  const sliderStep = maxOutputCeiling > 32_768 ? 1024 : 256

  const providerOptions: { value: Provider; label: string; badge: string }[] = [
    { value: 'anthropic',  label: 'Anthropic',       badge: 'Claude'        },
    { value: 'openai',     label: 'OpenAI',           badge: 'GPT'           },
    { value: 'gemini',     label: 'Google Gemini',    badge: 'Vertex AI'     },
    { value: 'nvidia',     label: 'NVIDIA NIM',       badge: 'OpenAI-compat' },
    { value: 'openrouter', label: 'OpenRouter',       badge: '300+ models'   },
    { value: 'custom',     label: 'Custom / Local',   badge: 'OpenAI-compat' }
  ]

  // ── shared input / select className helpers ──────────────────────────────
  const inputCls =
    'w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors'

  const selectCls =
    'w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500 transition-colors'

  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'
  const hintCls  = 'text-xs text-gray-400 dark:text-gray-600 mt-1'

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* Drag region + header */}
      <div
        className="h-9 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 flex items-center px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Back to chat (Esc)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">

        {/* ── Left nav ───────────────────────────────────────────────── */}
        <nav className="w-52 flex-shrink-0 bg-gray-100/80 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 overflow-y-auto py-2">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left
                ${selectedSection === item.id
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* ── Right content panel ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8">
            <h2 className="text-lg font-semibold mb-6 text-gray-900 dark:text-gray-100">
              {NAV_ITEMS.find(i => i.id === selectedSection)?.label ?? 'Settings'}
            </h2>

            {/* ── Models section ──────────────────────────────────────── */}
            {selectedSection === 'models' && (<>

          {/* ── Provider dropdown ────────────────────────────────────── */}
          <section className="mb-5">
            <label className={labelCls}>Provider</label>
            <select
              value={form.provider}
              onChange={(e) => handleProviderChange(e.target.value as Provider)}
              className={selectCls}
            >
              {providerOptions.map(({ value, label, badge }) => (
                <option key={value} value={value}>
                  {label} — {badge}
                </option>
              ))}
            </select>
          </section>

          {/* ── Local AI quick-setup card (shown when NOT on custom provider) ── */}
          {form.provider !== 'custom' && (
            <section className="mb-5">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none mt-0.5">🦙</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                      Run AI locally for free — no API key
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                      Ollama lets you run Llama 3, DeepSeek, Qwen-Coder and more on your machine. Your code never leaves your computer.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['llama3.2', 'qwen2.5-coder:7b', 'deepseek-r1:8b', 'mistral'].map(m => (
                        <span key={m} className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-800/50 text-[11px] font-mono text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                          {m}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => handleProviderChange('custom' as Provider)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                        </svg>
                        Switch to Local AI
                      </button>
                      <a
                        href="https://ollama.ai"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        Get Ollama →
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Vertex AI / Gemini fields ─────────────────────────── */}
          {isGemini && (
            <>
              <section className="mb-4">
                <label className={labelCls}>
                  GCP Project ID
                  <span className="text-gray-400 dark:text-gray-500 font-normal ml-2">— your Google Cloud project</span>
                </label>
                <input
                  type="text"
                  value={form.vertexProjectId}
                  onChange={(e) => setForm({ ...form, vertexProjectId: e.target.value })}
                  placeholder="my-gcp-project-id"
                  className={inputCls}
                />
              </section>

              <section className="mb-4">
                <label className={labelCls}>Location</label>
                <select
                  value={form.vertexLocation}
                  onChange={(e) => setForm({ ...form, vertexLocation: e.target.value })}
                  className={selectCls}
                >
                  {VERTEX_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}{loc === 'global' ? '  (default)' : ''}
                    </option>
                  ))}
                </select>
              </section>

              {/* Service Account Key */}
              <section className="mb-5">
                <label className={labelCls}>
                  Service Account Key (JSON)
                  <span className="text-gray-400 dark:text-gray-500 font-normal ml-2">— stored encrypted</span>
                </label>

                {/* Upload row */}
                <div className="flex items-center gap-2 mb-2">
                  <label className="cursor-pointer flex items-center gap-2 px-3 py-1.5 rounded-lg
                                    bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
                                    border border-gray-300 dark:border-gray-600
                                    text-sm text-gray-700 dark:text-gray-200 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Upload .json file
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setSaFileName(file.name)
                        const reader = new FileReader()
                        reader.onload = (ev) => {
                          const content = ev.target?.result as string
                          try {
                            JSON.parse(content)
                            setForm((prev) => ({ ...prev, vertexServiceAccountKey: content }))
                          } catch {
                            alert('Invalid JSON — please select a valid service account key file.')
                            setSaFileName(null)
                          }
                        }
                        reader.readAsText(file)
                        e.target.value = ''
                      }}
                    />
                  </label>

                  {saFileName && (
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      {saFileName}
                    </span>
                  )}
                  {form.vertexServiceAccountKey && !saFileName && (
                    <span className="text-xs text-green-600 dark:text-green-400">✓ Key loaded</span>
                  )}
                  {form.vertexServiceAccountKey && (
                    <button
                      onClick={() => { setForm((p) => ({ ...p, vertexServiceAccountKey: '' })); setSaFileName(null) }}
                      className="ml-auto text-xs text-gray-400 hover:text-red-500 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Paste fallback */}
                <div className="relative">
                  <textarea
                    rows={showSA ? 8 : 2}
                    value={form.vertexServiceAccountKey}
                    onChange={(e) => { setForm({ ...form, vertexServiceAccountKey: e.target.value }); setSaFileName(null) }}
                    placeholder={'Or paste JSON here…\n{ "type": "service_account", "project_id": "..." }'}
                    className={`${inputCls} font-mono text-xs resize-none`}
                  />
                  <button
                    onClick={() => setShowSA((s) => !s)}
                    className="absolute right-2 top-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1"
                  >
                    {showSA ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                <p className={hintCls}>
                  Leave blank to use Application Default Credentials (ADC).
                  Create a key at{' '}
                  <span className="text-blue-500">GCP Console → IAM → Service Accounts → Keys</span>
                </p>
              </section>
            </>
          )}

          {/* ── Sign in with OpenAI (ChatGPT subscription) ──────────── */}
          {form.provider === 'openai' && (
            <section className="mb-5">
              <label className={labelCls}>
                Sign in with OpenAI
                <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
                  Uses ChatGPT Plus / Pro subscription
                </span>
              </label>
              <p className={`${hintCls} mb-3`}>
                Log in through the browser — no API key needed. Chats draw from your
                existing ChatGPT subscription quota (Plus / Pro / Team).
                Uses the same public client as OpenAI's Codex CLI.
              </p>

              {oauthValid ? (
                /* Connected state */
                <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center flex-wrap gap-x-2 gap-y-1">
                          {oauthToken?.name ?? 'Connected to OpenAI'}
                          {oauthToken?.email && (
                            <span className="text-xs font-normal text-gray-500 dark:text-gray-400">{oauthToken.email}</span>
                          )}
                          {oauthToken?.planType && oauthToken.planType !== 'free' && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200">
                              {oauthToken.planType}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {formatOAuthExpiry(oauthToken?.expiresAt)}
                          {' · '}API key will be ignored while signed in
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {oauthToken?.refreshToken && (
                        <button onClick={handleOpenAIRefresh} disabled={oauthLoading}
                                className="text-xs text-blue-500 hover:text-blue-600 disabled:opacity-40 transition-colors">
                          Refresh
                        </button>
                      )}
                      <button onClick={handleOpenAILogout}
                              className="text-xs px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                        Sign out
                      </button>
                    </div>
                  </div>
                </div>
              ) : oauthExpired ? (
                /* Expired state */
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
                      <p className="text-sm text-amber-700 dark:text-amber-400">Token expired — please sign in again.</p>
                    </div>
                    <div className="flex gap-2">
                      {oauthToken?.refreshToken && (
                        <button onClick={handleOpenAIRefresh} disabled={oauthLoading}
                                className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 transition-colors">
                          {oauthLoading ? 'Refreshing…' : 'Refresh token'}
                        </button>
                      )}
                      <button onClick={handleOpenAILogin} disabled={oauthLoading}
                              className="text-xs px-3 py-1.5 rounded-lg bg-black dark:bg-white text-white dark:text-black hover:opacity-80 disabled:opacity-40 transition-colors">
                        Sign in again
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Not connected */
                <button onClick={handleOpenAILogin} disabled={oauthLoading}
                        className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl bg-black dark:bg-white text-white dark:text-black hover:opacity-80 disabled:opacity-50 transition-opacity font-medium text-sm">
                  {oauthLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Opening browser…
                    </>
                  ) : (
                    <>
                      {/* OpenAI logo mark */}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 004.981 4.18a5.985 5.985 0 00-3.998 2.9 6.046 6.046 0 00.743 7.097 5.98 5.98 0 00.51 4.911 6.051 6.051 0 006.515 2.9A5.985 5.985 0 0013.26 24a6.056 6.056 0 005.772-4.206 5.99 5.99 0 003.997-2.9 6.056 6.056 0 00-.747-7.073zM13.26 22.43a4.476 4.476 0 01-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 00.392-.681v-6.737l2.02 1.168a.071.071 0 01.038.052v5.583a4.504 4.504 0 01-4.494 4.494zM3.6 18.304a4.47 4.47 0 01-.535-3.014l.142.085 4.783 2.759a.771.771 0 00.78 0l5.843-3.369v2.332a.08.08 0 01-.033.062L9.74 19.95a4.5 4.5 0 01-6.14-1.646zM2.34 7.896a4.485 4.485 0 012.366-1.973V11.6a.766.766 0 00.388.676l5.815 3.355-2.02 1.168a.076.076 0 01-.071 0l-4.83-2.786A4.504 4.504 0 012.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 01.071 0l4.83 2.791a4.494 4.494 0 01-.676 8.105v-5.678a.79.79 0 00-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 00-.785 0L9.409 9.23V6.897a.066.066 0 01.028-.061l4.83-2.787a4.5 4.5 0 016.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 01-.038-.057V6.075a4.5 4.5 0 017.375-3.453l-.142.08L8.704 5.46a.795.795 0 00-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
                      </svg>
                      Sign in with OpenAI
                    </>
                  )}
                </button>
              )}

              {oauthError && (
                <p className="mt-2 text-xs text-red-500 dark:text-red-400">{oauthError}</p>
              )}

              <div className="mt-3 flex items-start gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  When signed in, chats use the ChatGPT subscription endpoint. You can still fill in an API key below as a fallback for when the OAuth token expires.
                </span>
              </div>
            </section>
          )}

          {/* ── API Key (non-Gemini) ──────────────────────────────────── */}
          {needsApiKey && (
            <section className="mb-5">
              <label className={labelCls}>
                API Key
                <span className="text-gray-400 dark:text-gray-500 font-normal ml-2">— stored encrypted</span>
                {form.provider === 'openai' && oauthValid && (
                  <span className="ml-2 text-xs font-normal text-amber-500 dark:text-amber-400">(ignored while signed in)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={
                    form.provider === 'anthropic' ? 'sk-ant-…' :
                    form.provider === 'openai'    ? 'sk-… (optional when signed in above)' :
                    'API key (or blank for local)'
                  }
                  className={`${inputCls} pr-16`}
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className={hintCls}>
                {form.provider === 'anthropic'  && <>Get your key at <span className="text-blue-500">console.anthropic.com</span></>}
                {form.provider === 'openai'     && <>Get your key at <span className="text-blue-500">platform.openai.com/api-keys</span></>}
                {form.provider === 'nvidia'     && <>Get your free API key at <span className="text-blue-500">build.nvidia.com</span> — 1000 free credits/month</>}
                {form.provider === 'openrouter' && <>Get your free key at <span className="text-blue-500">openrouter.ai/keys</span> — access 300+ models, many free</>}
              </p>
            </section>
          )}

          {/* ── Custom providers manager ─────────────────────────── */}
          {isCustom && (
            <section className="mb-5">
              <label className={labelCls}>
                Saved Custom Providers
                <span className="ml-1.5 text-gray-400 font-normal text-xs">— add any OpenAI-compatible endpoint</span>
              </label>
              <CustomProviderManager
                providers={form.customProviders ?? []}
                activeId={form.selectedCustomProviderId}
                onProviders={handleCustomProvidersChange}
                onSelect={handleSelectCustomProvider}
                inputCls={inputCls}
                labelCls={labelCls}
                hintCls={hintCls}
              />
            </section>
          )}

          {/* ── Base URL (custom — shown when a provider is active or editing manually) */}
          {isCustom && (
            <section className="mb-5">
              <label className={labelCls}>
                Active Base URL
                <span className="ml-1.5 text-gray-400 font-normal text-xs">— auto-filled when you click Use above</span>
              </label>
              <input
                type="text"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="http://localhost:11434/v1"
                className={inputCls}
              />
            </section>
          )}

          {/* ── Ollama model auto-detection ───────────────────────── */}
          {isCustom && (
            <section className="mb-5">
              <OllamaDetector
                onModelSelect={(model) => setForm(f => ({ ...f, model, baseUrl: 'http://localhost:11434/v1' }))}
              />
            </section>
          )}

          {/* ── Model ────────────────────────────────────────────────── */}
          <section className="mb-5">
            <label className={labelCls}>Model</label>
            {isCustom ? (
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="e.g. llama3.2, mistral, phi3, qwen2.5-coder"
                className={inputCls}
              />
            ) : isNvidia ? (
              <>
                <select
                  value={PROVIDER_MODELS.nvidia.includes(form.model) ? form.model : '__custom__'}
                  onChange={(e) => { if (e.target.value !== '__custom__') setForm({ ...form, model: e.target.value }) }}
                  className={selectCls}
                  size={1}
                >
                  {!PROVIDER_MODELS.nvidia.includes(form.model) && (
                    <option value="__custom__">{form.model} (custom)</option>
                  )}
                  <optgroup label="── Meta / Llama ──────────────────">
                    <option value="meta/llama-3.3-70b-instruct">meta/llama-3.3-70b-instruct</option>
                    <option value="meta/llama-3.1-405b-instruct">meta/llama-3.1-405b-instruct</option>
                    <option value="meta/llama-3.1-70b-instruct">meta/llama-3.1-70b-instruct</option>
                    <option value="meta/llama-3.1-8b-instruct">meta/llama-3.1-8b-instruct</option>
                    <option value="meta/llama-3.2-3b-instruct">meta/llama-3.2-3b-instruct</option>
                    <option value="meta/llama-3.2-1b-instruct">meta/llama-3.2-1b-instruct</option>
                    <option value="meta/llama-3.2-90b-vision-instruct">meta/llama-3.2-90b-vision-instruct</option>
                    <option value="meta/llama-3.2-11b-vision-instruct">meta/llama-3.2-11b-vision-instruct</option>
                    <option value="meta/codellama-70b">meta/codellama-70b</option>
                  </optgroup>
                  <optgroup label="── NVIDIA Nemotron ───────────────">
                    <option value="nvidia/llama-3.1-nemotron-ultra-253b-v1">nvidia/llama-3.1-nemotron-ultra-253b-v1</option>
                    <option value="nvidia/llama-3.3-nemotron-super-49b-v1">nvidia/llama-3.3-nemotron-super-49b-v1</option>
                    <option value="nvidia/llama-3.3-nemotron-super-49b-v1.5">nvidia/llama-3.3-nemotron-super-49b-v1.5</option>
                    <option value="nvidia/llama-3.1-nemotron-nano-8b-v1">nvidia/llama-3.1-nemotron-nano-8b-v1</option>
                    <option value="nvidia/nemotron-mini-4b-instruct">nvidia/nemotron-mini-4b-instruct</option>
                  </optgroup>
                  <optgroup label="── Mistral ───────────────────────">
                    <option value="mistralai/mistral-nemotron">mistralai/mistral-nemotron</option>
                    <option value="mistralai/mistral-large">mistralai/mistral-large</option>
                    <option value="mistralai/mistral-small-24b-instruct">mistralai/mistral-small-24b-instruct</option>
                    <option value="mistralai/mixtral-8x22b-instruct">mistralai/mixtral-8x22b-instruct</option>
                    <option value="mistralai/mixtral-8x7b-instruct">mistralai/mixtral-8x7b-instruct</option>
                    <option value="mistralai/mistral-7b-instruct-v0.3">mistralai/mistral-7b-instruct-v0.3</option>
                    <option value="mistralai/codestral-22b-instruct-v0.1">mistralai/codestral-22b-instruct-v0.1</option>
                    <option value="mistralai/mathstral-7b-v01">mistralai/mathstral-7b-v01</option>
                  </optgroup>
                  <optgroup label="── DeepSeek ──────────────────────">
                    <option value="deepseek-ai/deepseek-v3.1">deepseek-ai/deepseek-v3.1</option>
                    <option value="deepseek-ai/deepseek-r1-distill-qwen-32b">deepseek-ai/deepseek-r1-distill-qwen-32b</option>
                    <option value="deepseek-ai/deepseek-r1-distill-qwen-14b">deepseek-ai/deepseek-r1-distill-qwen-14b</option>
                    <option value="deepseek-ai/deepseek-r1-distill-qwen-7b">deepseek-ai/deepseek-r1-distill-qwen-7b</option>
                    <option value="deepseek-ai/deepseek-r1-distill-llama-8b">deepseek-ai/deepseek-r1-distill-llama-8b</option>
                  </optgroup>
                  <optgroup label="── Qwen ──────────────────────────">
                    <option value="qwen/qwen3-coder-480b-a35b-instruct">qwen/qwen3-coder-480b-a35b-instruct</option>
                    <option value="qwen/qwen3-5-122b-a10b">qwen/qwen3-5-122b-a10b</option>
                    <option value="qwen/qwq-32b">qwen/qwq-32b</option>
                    <option value="qwen/qwen2.5-coder-32b-instruct">qwen/qwen2.5-coder-32b-instruct</option>
                    <option value="qwen/qwen2.5-coder-7b-instruct">qwen/qwen2.5-coder-7b-instruct</option>
                    <option value="qwen/qwen2.5-7b-instruct">qwen/qwen2.5-7b-instruct</option>
                  </optgroup>
                  <optgroup label="── Google Gemma ──────────────────">
                    <option value="google/gemma-2-27b-it">google/gemma-2-27b-it</option>
                    <option value="google/gemma-2-9b-it">google/gemma-2-9b-it</option>
                    <option value="google/gemma-3-1b-it">google/gemma-3-1b-it</option>
                    <option value="google/codegemma-1.1-7b">google/codegemma-1.1-7b</option>
                  </optgroup>
                  <optgroup label="── Microsoft Phi ─────────────────">
                    <option value="microsoft/phi-4-mini-instruct">microsoft/phi-4-mini-instruct</option>
                    <option value="microsoft/phi-4-mini-flash-reasoning">microsoft/phi-4-mini-flash-reasoning</option>
                    <option value="microsoft/phi-3.5-mini">microsoft/phi-3.5-mini</option>
                    <option value="microsoft/phi-3-medium-128k-instruct">microsoft/phi-3-medium-128k-instruct</option>
                    <option value="microsoft/phi-3-mini-128k-instruct">microsoft/phi-3-mini-128k-instruct</option>
                  </optgroup>
                  <optgroup label="── MiniMax ───────────────────────">
                    <option value="minimaxai/minimax-m2.5">minimaxai/minimax-m2.5</option>
                    <option value="minimaxai/minimax-m2.7">minimaxai/minimax-m2.7</option>
                  </optgroup>
                  <optgroup label="── Z-AI / GLM (Zhipu) ───────────">
                    <option value="z-ai/glm4.7">z-ai/glm4.7</option>
                    <option value="z-ai/glm5">z-ai/glm5</option>
                  </optgroup>
                  <optgroup label="── IBM Granite ───────────────────">
                    <option value="ibm/granite-3_3-8b-instruct">ibm/granite-3_3-8b-instruct</option>
                    <option value="ibm/granite-guardian-3.0-8b">ibm/granite-guardian-3.0-8b</option>
                  </optgroup>
                  <optgroup label="── Moonshot / Kimi ───────────────">
                    <option value="moonshotai/kimi-k2-instruct">moonshotai/kimi-k2-instruct</option>
                  </optgroup>
                  <optgroup label="── TII Falcon ────────────────────">
                    <option value="tiiuae/falcon3-7b-instruct">tiiuae/falcon3-7b-instruct</option>
                  </optgroup>
                  <optgroup label="── Other ─────────────────────────">
                    <option value="openai/gpt-oss-120b">openai/gpt-oss-120b</option>
                    <option value="openai/gpt-oss-20b">openai/gpt-oss-20b</option>
                    <option value="bytedance/seed-oss-36b-instruct">bytedance/seed-oss-36b-instruct</option>
                    <option value="ai21labs/jamba-1.5-mini-instruct">ai21labs/jamba-1.5-mini-instruct</option>
                    <option value="bigcode/starcoder2-7b">bigcode/starcoder2-7b</option>
                    <option value="upstage/solar-10.7b-instruct">upstage/solar-10.7b-instruct</option>
                    <option value="abacusai/dracarys-llama-3.1-70b-instruct">abacusai/dracarys-llama-3.1-70b-instruct</option>
                    <option value="sarvamai/sarvam-m">sarvamai/sarvam-m</option>
                    <option value="marin/marin-8b-instruct">marin/marin-8b-instruct</option>
                    <option value="igenius/colosseum_355b_instruct_16k">igenius/colosseum_355b_instruct_16k</option>
                  </optgroup>
                </select>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="or type any model ID from build.nvidia.com"
                  className={`${inputCls} mt-2 text-xs`}
                />
                <p className={hintCls}>Browse all models at <span className="text-blue-500">build.nvidia.com/explore</span></p>
              </>
            ) : isOpenRouter ? (
              <>
                {orLoading && (
                  <p className={hintCls + ' animate-pulse'}>Loading models from OpenRouter…</p>
                )}
                {!orLoading && orModels.length === 0 && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      placeholder="e.g. google/gemma-3-27b-it:free"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => { orFetchedRef.current = false; fetchOrModels(form.apiKey || undefined) }}
                      className="flex-shrink-0 px-3 py-2 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                    >
                      Load
                    </button>
                  </div>
                )}
                {orModels.length > 0 && (
                  <>
                    <select
                      value={orModels.find(m => m.id === form.model) ? form.model : '__custom__'}
                      onChange={(e) => { if (e.target.value !== '__custom__') setForm({ ...form, model: e.target.value }) }}
                      className={selectCls}
                    >
                      {!orModels.find(m => m.id === form.model) && (
                        <option value="__custom__">{form.model || '— select a model —'}</option>
                      )}
                      <optgroup label="── Free models ─────────────────────">
                        {orModels.filter(m => m.isFree).map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
                        ))}
                      </optgroup>
                      <optgroup label="── Paid models ─────────────────────">
                        {orModels.filter(m => !m.isFree).map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
                        ))}
                      </optgroup>
                    </select>
                    <input
                      type="text"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      placeholder="or type any model ID"
                      className={`${inputCls} mt-2 text-xs`}
                    />
                  </>
                )}
                <p className={hintCls}>Browse all models at <span className="text-blue-500">openrouter.ai/models</span></p>
              </>
            ) : isOpenAI ? (
              <>
                {openAILoading && (
                  <p className={hintCls + ' animate-pulse'}>Fetching live models from OpenAI…</p>
                )}
                {/* Always show the model picker — fallback list while loading or if fetch failed */}
                {!openAILoading && (
                  <div className="flex items-center gap-2">
                    <select
                      value={
                        openAIModels.length > 0
                          ? (openAIModels.includes(form.model) ? form.model : '__custom__')
                          : form.model
                      }
                      onChange={(e) => { if (e.target.value !== '__custom__') setForm({ ...form, model: e.target.value }) }}
                      className={`${selectCls} flex-1`}
                    >
                      {openAIModels.length > 0 ? (
                        <>
                          {!openAIModels.includes(form.model) && form.model && (
                            <option value="__custom__">{form.model}</option>
                          )}
                          {openAIModels.some(m => m.startsWith('gpt-5')) && (
                            <optgroup label="── GPT-5 ────────────────────────">
                              {openAIModels.filter(m => m.startsWith('gpt-5')).map(m => <option key={m} value={m}>{m}</option>)}
                            </optgroup>
                          )}
                          <optgroup label="── GPT-4.1 ──────────────────────">
                            {openAIModels.filter(m => m.startsWith('gpt-4.1')).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                          <optgroup label="── Reasoning (o-series) ─────────">
                            {openAIModels.filter(m => /^o\d/.test(m)).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                          <optgroup label="── GPT-4o ───────────────────────">
                            {openAIModels.filter(m => m.startsWith('gpt-4o')).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                          <optgroup label="── Other ────────────────────────">
                            {openAIModels.filter(m => !m.startsWith('gpt-5') && !m.startsWith('gpt-4.1') && !/^o\d/.test(m) && !m.startsWith('gpt-4o')).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                        </>
                      ) : (
                        <>
                          {!PROVIDER_MODELS['openai'].includes(form.model) && form.model && (
                            <option value={form.model}>{form.model}</option>
                          )}
                          <optgroup label="── GPT-5 ────────────────────────">
                            {PROVIDER_MODELS['openai'].filter(m => m.startsWith('gpt-5')).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                          <optgroup label="── GPT-4.1 ──────────────────────">
                            {PROVIDER_MODELS['openai'].filter(m => m.startsWith('gpt-4.1')).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                          <optgroup label="── Reasoning (o-series) ─────────">
                            {PROVIDER_MODELS['openai'].filter(m => /^o\d/.test(m)).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                          <optgroup label="── GPT-4o ───────────────────────">
                            {PROVIDER_MODELS['openai'].filter(m => m.startsWith('gpt-4o')).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                          <optgroup label="── Legacy ───────────────────────">
                            {PROVIDER_MODELS['openai'].filter(m => m.startsWith('gpt-4-') || m.startsWith('gpt-3')).map(m => <option key={m} value={m}>{m}</option>)}
                          </optgroup>
                        </>
                      )}
                    </select>
                    {/* Refresh button — visible once live list is loaded */}
                    <button
                      type="button"
                      onClick={() => {
                        const key = form.apiKey?.trim() || form.openaiOAuth?.accessToken
                        if (!key) return
                        openAIFetchedRef.current = false
                        setOpenAIModels([])
                        fetchOpenAIModels(key)
                      }}
                      title="Refresh model list from OpenAI"
                      className="flex-shrink-0 p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-blue-500 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                )}
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="or type any model ID (e.g. gpt-4.1, o4-mini)"
                  className={`${inputCls} mt-2 text-xs`}
                />
                <p className={hintCls}>
                  {openAIModels.length > 0
                    ? <>{openAIModels.length} live models · <span className="text-blue-500">platform.openai.com/docs/models</span></>
                    : <>(Live list auto-loads when an API key or OAuth session is present)</> }
                </p>
              </>
            ) : (
              <select
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className={selectCls}
              >
                {PROVIDER_MODELS[form.provider].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
            {isGemini && (
              <p className={hintCls}>Ensure the model is enabled in your GCP project's Vertex AI Model Garden.</p>
            )}
          </section>

          {/* ── Fast / Lightweight Model ─────────────────────────────── */}
          <section className="mb-5">
            <label className={labelCls}>
              Fast Model
              <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">optional</span>
            </label>
            <p className={`${hintCls} mb-2`}>
              When set, lightweight tasks like auto-title generation and inline editor completions use this
              cheaper/faster model instead of the primary one — saving cost without sacrificing quality on
              the tasks that matter.
            </p>
            <input
              type="text"
              value={form.fastModel ?? ''}
              onChange={(e) => setForm({ ...form, fastModel: e.target.value || undefined })}
              placeholder={
                form.provider === 'anthropic' ? 'e.g. claude-haiku-4-5' :
                form.provider === 'openai'    ? 'e.g. gpt-4o-mini' :
                form.provider === 'gemini'    ? 'e.g. gemini-2.5-flash-preview-04-17' :
                'Leave blank to use the primary model'
              }
              className={inputCls}
            />
          </section>

          {/* ── Max Tokens ───────────────────────────────────────────── */}
          <section className="mb-5">
            <label className={labelCls}>
              Max Tokens
              <span className="text-gray-400 dark:text-gray-500 font-normal ml-2">({form.maxTokens.toLocaleString()})</span>
            </label>
            <input
              type="range" min={256} max={maxOutputCeiling} step={sliderStep}
              value={Math.min(form.maxTokens, maxOutputCeiling)}
              onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-600 mt-1">
              <span>256</span><span>{maxOutputCeiling.toLocaleString()}</span>
            </div>
          </section>

          {/* ── Max Iterations ───────────────────────────────────────── */}
          <section className="mb-5">
            <label className={labelCls}>
              Max Tool-Call Iterations
              <span className="text-gray-400 dark:text-gray-500 font-normal ml-2">({form.maxIterations})</span>
            </label>
            <p className={`${hintCls} mb-2`}>
              How many rounds of tool calls the AI can make in a single turn.
              Higher values let it do deep research and multi-step coding tasks.
              Lower values cap cost and runtime.
            </p>
            <input
              type="range" min={1} max={200} step={1}
              value={form.maxIterations}
              onChange={(e) => setForm({ ...form, maxIterations: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-600 mt-1">
              <span>1 (single reply)</span>
              <span className="text-center">100 (default)</span>
              <span>200 (deep research)</span>
            </div>
          </section>
            </>)}

            {/* ── System Prompt section ───────────────────────────────── */}
            {selectedSection === 'prompt' && (<>
          <section className="mb-6">
            <label className={labelCls}>System Prompt</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, systemPrompt: DEFAULT_SETTINGS.systemPrompt })}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  form.systemPrompt === DEFAULT_SETTINGS.systemPrompt
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => {
                  if (form.systemPrompt === DEFAULT_SETTINGS.systemPrompt) {
                    setForm({ ...form, systemPrompt: '' })
                  }
                }}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  form.systemPrompt !== DEFAULT_SETTINGS.systemPrompt
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                Custom
              </button>
            </div>

            {form.systemPrompt === DEFAULT_SETTINGS.systemPrompt ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                Using the built-in Aether system prompt. Switch to Custom to write your own.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Your custom prompt</span>
                  <TemplateDropdown
                    currentPrompt={form.systemPrompt}
                    onSelect={(prompt) => setForm({ ...form, systemPrompt: prompt })}
                  />
                </div>
                <textarea
                  rows={6}
                  placeholder="Enter your system prompt…"
                  value={form.systemPrompt}
                  onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                  className={`${inputCls} resize-none`}
                />
                {(() => {
                  const match = findMatchingTemplate(form.systemPrompt)
                  return match ? (
                    <p className="text-[11px] text-blue-500 dark:text-blue-400 mt-1">
                      {match.icon} Using template: <span className="font-medium">{match.name}</span>
                    </p>
                  ) : null
                })()}
              </>
            )}
          </section>
            </>)}

            {/* ── General section ─────────────────────────────────────── */}
            {selectedSection === 'general' && (<>
          <section className="mb-6">
            <label className={labelCls}>Theme</label>
            <div className="flex gap-2 mt-1">
              {(['dark', 'light', 'system'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, theme: t }))}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                    form.theme === t
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {t === 'dark' ? '🌙 Dark' : t === 'light' ? '☀️ Light' : '💻 System'}
                </button>
              ))}
            </div>
            <p className={`${hintCls} mt-1.5`}>System follows your OS dark/light preference automatically.</p>
          </section>
            </>)}

            {/* ── Workspace section ───────────────────────────────────── */}
            {selectedSection === 'workspace' && (<>
          <section className="mb-6">
            <label className={labelCls}>
              Workspace Folder
              <span className="ml-2 font-normal text-blue-500 dark:text-blue-400 text-xs">Agent tool use</span>
            </label>
            <p className={`${hintCls} mb-2`}>
              The folder the AI agent can read, write, and run commands in.
              Required for tool use (Anthropic provider only).
            </p>
            <div className="flex items-center gap-2">
              <div className={`${inputCls} flex-1 font-mono text-xs truncate ${!form.workspacePath ? 'text-gray-400 dark:text-gray-600 italic' : ''}`}>
                {form.workspacePath || 'No folder selected'}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const result = await window.api.pickFolder()
                  if (result.path) setForm(prev => ({ ...prev, workspacePath: result.path! }))
                }}
                className="flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors
                           bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
                           text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600"
              >
                Browse…
              </button>
              {form.workspacePath && (
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, workspacePath: '' }))}
                  className="flex-shrink-0 text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {form.workspacePath && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Agent tools enabled — AI can read/write files and run commands in this folder
              </div>
            )}
          </section>

          {/* ── Codebase Index ────────────────────────────────────────── */}
          {form.workspacePath && (
            <section className="mb-6 border-t border-gray-200 dark:border-gray-800 pt-6">
              <label className={labelCls}>
                Codebase Index
                <span className="ml-2 font-normal text-purple-500 dark:text-purple-400 text-xs">Semantic search</span>
              </label>
              <p className={`${hintCls} mb-3`}>
                Indexes your workspace so the AI can use <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">semantic_search</code> to
                find relevant files by concept. Also enables the search panel below.
              </p>

              {/* ── BM25 index (agent tool) ── */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-3">
                <div className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60 flex items-center gap-3">
                  <span className="text-lg">🔍</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Keyword Index <span className="font-normal text-gray-400">(BM25 — agent tool)</span>
                    </p>
                    {bm25Info?.exists ? (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                        ✓ {bm25Info.chunkCount.toLocaleString()} chunks · {bm25Info.fileCount} files
                        {bm25Info.createdAt > 0 && (
                          <span className="text-gray-400"> · {new Date(bm25Info.createdAt).toLocaleDateString()}</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">Not indexed yet</p>
                    )}
                  </div>
                  <button
                    onClick={handleBuildBm25}
                    disabled={bm25Building}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                               bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
                               text-gray-700 dark:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bm25Building ? 'Building…' : bm25Info?.exists ? 'Re-index' : 'Build Index'}
                  </button>
                </div>

                {/* BM25 progress */}
                {bm25Building && bm25Status && (
                  <div className="px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{bm25Status.message}</span>
                    </div>
                    {bm25Status.total > 0 && (
                      <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.round((bm25Status.done / bm25Status.total) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {bm25Status?.phase === 'done' && !bm25Building && (
                  <div className="px-3 py-2 bg-green-50 dark:bg-green-900/20 border-t border-green-100 dark:border-green-900">
                    <span className="text-xs text-green-600 dark:text-green-400">✓ {bm25Status.message}</span>
                  </div>
                )}
                {bm25Status?.phase === 'error' && (
                  <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border-t border-red-100 dark:border-red-900">
                    <span className="text-xs text-red-500 dark:text-red-400">✕ {bm25Status.message}</span>
                  </div>
                )}
              </div>

              {/* ── Dense embedding index (WASM, optional) ── */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-4">
                <div className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60 flex items-center gap-3">
                  <span className="text-lg">🧠</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      Embedding Index <span className="font-normal text-gray-400">(MiniLM-L6 · WASM · local)</span>
                    </p>
                    {embedState.phase === 'done' ? (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                        ✓ {embedState.detail}
                      </p>
                    ) : embedState.phase === 'error' ? (
                      <p className="text-xs text-red-500 mt-0.5">{embedState.detail}</p>
                    ) : embedState.phase !== 'idle' ? (
                      <p className="text-xs text-blue-500 mt-0.5">{embedState.detail}</p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-0.5">Not indexed — first run downloads ~23 MB model</p>
                    )}
                  </div>
                  <button
                    onClick={buildEmbedIndex}
                    disabled={['model-loading','fetching-files','embedding','saving'].includes(embedState.phase)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                               bg-purple-100 dark:bg-purple-900/40 hover:bg-purple-200 dark:hover:bg-purple-900/60
                               text-purple-700 dark:text-purple-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {embedState.phase === 'idle' || embedState.phase === 'done' || embedState.phase === 'error'
                      ? (embedState.phase === 'done' ? 'Re-index' : 'Build')
                      : 'Building…'}
                  </button>
                </div>

                {/* Embedding progress */}
                {(['model-loading','fetching-files','embedding','saving'] as const).includes(embedState.phase as never) && (
                  <div className="px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg className="w-3 h-3 animate-spin text-purple-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{embedState.detail}</span>
                      {embedState.chunksTotal > 0 && (
                        <span className="ml-auto text-xs text-gray-400">
                          {embedState.chunksDone} / {embedState.chunksTotal}
                        </span>
                      )}
                    </div>
                    {embedState.progress > 0 && (
                      <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all duration-300"
                          style={{ width: `${embedState.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Test search ── */}
              {embedState.phase === 'done' && (
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Test semantic search</p>
                  <div className="flex gap-2">
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSemanticSearch()}
                      placeholder='e.g. "authentication middleware"'
                      className={`${inputCls} flex-1 text-xs`}
                    />
                    <button
                      onClick={handleSemanticSearch}
                      disabled={searching || !searchQuery.trim()}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition-colors"
                    >
                      {searching ? '…' : 'Search'}
                    </button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                      {searchResults.map((r, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-white dark:bg-gray-900">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-blue-600 dark:text-blue-400 truncate flex-1">{r.path}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">L{r.startLine}–{r.endLine}</span>
                            <span className="text-xs text-purple-500 flex-shrink-0">↑{r.score.toFixed(2)}</span>
                          </div>
                          <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap line-clamp-3 font-mono">{r.excerpt}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
            </>)}

            {/* ── MCP Servers section ─────────────────────────────────── */}
            {selectedSection === 'mcp' && (
              <Suspense fallback={<div className="py-8 text-center text-sm text-gray-400">Loading…</div>}>
                <McpServersPanel
                  embedded
                  settings={form}
                  onSettingsUpdate={(s) => { setForm(s); setHasChanges(true) }}
                  onClose={() => {}}
                />
              </Suspense>
            )}

            {/* ── Integrations section ────────────────────────────────── */}
            {selectedSection === 'integrations' && (<>
          <section className="mb-6">
            <label className={labelCls}>
              Brave Search API Key
              <span className="ml-2 font-normal text-orange-500 dark:text-orange-400 text-xs">Web search tool</span>
            </label>
            <p className={`${hintCls} mb-2`}>
              Enables the AI to search the web and fetch URLs. Get a free key at{' '}
              <a
                href="https://brave.com/search/api/"
                target="_blank"
                rel="noreferrer"
                className="text-blue-500 hover:underline"
              >
                brave.com/search/api
              </a>
              {' '}(free tier: 2 000 queries/month).
            </p>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.braveApiKey}
                onChange={(e) => setForm({ ...form, braveApiKey: e.target.value })}
                placeholder="BSA…"
                className={`${inputCls} w-full pr-10 font-mono text-sm`}
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {form.braveApiKey ? (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                ✓ Web search enabled — AI can search the web and fetch any URL
              </p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Without a key the AI can still fetch URLs you paste directly in chat, but cannot search
              </p>
            )}
          </section>
            </>)}

            {/* ── Advanced section ────────────────────────────────────── */}
            {selectedSection === 'advanced' && (<>
          <section className="mb-6">
            <label className={labelCls}>Generation Parameters</label>
            <p className={`${hintCls} mb-4`}>
              Control randomness and output diversity. Leave at default for most tasks.
            </p>

            {/* Temperature */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Temperature</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-blue-600 dark:text-blue-400 w-16 text-right">
                    {form.temperature !== undefined ? form.temperature.toFixed(2) : 'default'}
                  </span>
                  {form.temperature !== undefined && (
                    <button type="button" onClick={() => setForm(f => ({ ...f, temperature: undefined }))}
                            className="text-[10px] text-gray-400 hover:text-red-500 transition-colors" title="Reset">✕</button>
                  )}
                </div>
              </div>
              <input type="range" min={0} max={1} step={0.01}
                     value={form.temperature ?? 0.7}
                     onMouseDown={() => { if (form.temperature === undefined) setForm(f => ({ ...f, temperature: 0.7 })) }}
                     onChange={e => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))}
                     className="w-full accent-blue-500 cursor-pointer" />
              <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">
                <span>0 — deterministic</span>
                <span>1 — creative</span>
              </div>
            </div>

            {/* Top P */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Top P (nucleus sampling)</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-blue-600 dark:text-blue-400 w-16 text-right">
                    {form.topP !== undefined ? form.topP.toFixed(2) : 'default'}
                  </span>
                  {form.topP !== undefined && (
                    <button type="button" onClick={() => setForm(f => ({ ...f, topP: undefined }))}
                            className="text-[10px] text-gray-400 hover:text-red-500 transition-colors" title="Reset">✕</button>
                  )}
                </div>
              </div>
              <input type="range" min={0} max={1} step={0.01}
                     value={form.topP ?? 1.0}
                     onMouseDown={() => { if (form.topP === undefined) setForm(f => ({ ...f, topP: 1.0 })) }}
                     onChange={e => setForm(f => ({ ...f, topP: parseFloat(e.target.value) }))}
                     className="w-full accent-blue-500 cursor-pointer" />
              <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">
                <span>0 — narrow</span>
                <span>1 — full vocabulary</span>
              </div>
            </div>

            {/* Reasoning Depth */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Reasoning Depth</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                  {form.provider === 'anthropic' && 'Extended thinking — claude-opus-4 / sonnet-4 / 3-7'}
                  {form.provider === 'openai'    && 'Reasoning effort — o1, o3, o4-mini series'}
                  {form.provider === 'gemini'    && 'Thinking budget — gemini-2.5 / 3.1'}
                  {(form.provider === 'nvidia' || form.provider === 'custom') && 'Not supported by this provider'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['off', 'low', 'medium', 'high'] as const).map(d => {
                  const active = (form.reasoningDepth ?? 'off') === d
                  const unsupported = form.provider === 'nvidia' || form.provider === 'custom'
                  const icons   = { off: '◌', low: '○', medium: '◎', high: '●' }
                  const budgets: Record<string, Record<string, string>> = {
                    anthropic: { off: '—',    low: '1k t',  medium: '8k t',  high: '16k t'  },
                    openai:    { off: '—',    low: 'low',   medium: 'med',   high: 'high'   },
                    gemini:    { off: '0 t',  low: '512 t', medium: '4k t',  high: '16k t'  },
                  }
                  const budget = budgets[form.provider]?.[d] ?? (d === 'off' ? '—' : d)
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={unsupported && d !== 'off'}
                      onClick={() => setForm(f => ({ ...f, reasoningDepth: d }))}
                      className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border text-xs font-medium transition-all
                        ${active
                          ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                        }
                        ${unsupported && d !== 'off' ? 'opacity-30 cursor-not-allowed' : ''}`}
                    >
                      <span className={`text-base leading-none ${
                        d === 'high'   ? 'text-violet-500' :
                        d === 'medium' ? 'text-blue-500'   :
                        d === 'low'    ? 'text-blue-400'   : 'text-gray-300 dark:text-gray-600'
                      }`}>{icons[d]}</span>
                      <span className="capitalize">{d}</span>
                      <span className="text-[9px] text-gray-400 dark:text-gray-600 font-mono">{budget}</span>
                    </button>
                  )
                })}
              </div>
              <p className={`${hintCls} mt-1.5`}>
                Default for new conversations. Can be changed per-conversation in the chat input bar.
                {form.reasoningDepth && form.reasoningDepth !== 'off' && form.provider === 'anthropic' && (
                  <span className="block mt-0.5 text-yellow-600 dark:text-yellow-500">
                    ⚠ Extended thinking forces temperature = 1 and disables top_p.
                  </span>
                )}
              </p>
            </div>
          </section>

          {/* ── Edit Approval ────────────────────────────────────────── */}
          <section className="mb-6 border-t border-gray-200 dark:border-gray-800 pt-6">
            <label className={labelCls}>File Edit Approval</label>
            <p className={`${hintCls} mb-3`}>
              When enabled, the AI pauses before writing or editing any file and shows you a diff to review — just like Claude Code's edit flow.
              Disable to let the AI write files autonomously.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm(prev => ({ ...prev, requireEditApproval: !(prev.requireEditApproval !== false) }))}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer focus:outline-none
                  ${form.requireEditApproval !== false ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                role="switch"
                aria-checked={form.requireEditApproval !== false}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200
                    ${form.requireEditApproval !== false ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
              <span className={`text-sm font-medium ${form.requireEditApproval !== false ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {form.requireEditApproval !== false
                  ? 'On — review every file write before it happens'
                  : 'Off — AI writes files without prompting'}
              </span>
            </div>
          </section>

          {/* ── Command Approval ─────────────────────────────────────── */}
          <section className="mb-6 border-t border-gray-200 dark:border-gray-800 pt-6">
            <label className={labelCls}>Command Execution</label>

            {/* Auto-approve toggle */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Auto-approve commands</p>
                <p className={hintCls}>
                  When <strong>on</strong>, all safe commands run without asking.
                  Dangerous commands (<code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">rm -rf</code>,{' '}
                  <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">git reset --hard</code>, etc.)
                  always require approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, autoApproveCommands: !f.autoApproveCommands }))}
                className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors relative mt-0.5 ${form.autoApproveCommands ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.autoApproveCommands ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="mb-4">
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${form.autoApproveCommands ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                {form.autoApproveCommands
                  ? '⚡ Auto-run — safe commands execute immediately'
                  : '🔒 Manual approval — every command needs your OK'}
              </span>
            </div>

            {/* Trusted command prefixes */}
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Trusted Commands
              <span className="ml-2 font-normal text-green-600 dark:text-green-400 text-xs">Always auto-approved</span>
            </label>
            <p className={`${hintCls} mb-2`}>
              Command prefixes that always run without approval, even when auto-approve is off. One per line.
              Dangerous commands are never auto-approved regardless.
            </p>
            <textarea
              rows={6}
              value={(form.trustedCommands ?? []).join('\n')}
              onChange={(e) => {
                const commands = e.target.value
                  .split('\n')
                  .map(l => l.trim())
                  .filter(l => l.length > 0)
                setForm(prev => ({ ...prev, trustedCommands: commands }))
              }}
              placeholder={'npm\nyarn\npnpm\ncargo\ngo\npython\ngit status\ngit log\ngit diff'}
              className={`${inputCls} font-mono text-xs resize-y`}
              spellCheck={false}
            />
            <p className={hintCls}>
              {(form.trustedCommands ?? []).length} trusted prefix{(form.trustedCommands ?? []).length !== 1 ? 'es' : ''} ·
              Commands are matched by prefix (e.g. <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">npm</code> trusts any <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">npm …</code> command)
            </p>
          </section>

          {/* ── RAG & API Server ─────────────────────────────────── */}
          <section className="mb-6 border-t border-gray-200 dark:border-gray-800 pt-6">
            <label className={labelCls}>Agent Features</label>

            {/* RAG toggle */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Auto-RAG</p>
                <p className={hintCls}>Automatically inject semantically relevant workspace chunks into context before each message. Requires BM25 index to be built.</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, ragEnabled: !f.ragEnabled }))}
                className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors relative mt-0.5 ${form.ragEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.ragEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {/* HTTP API server */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Local HTTP API</p>
                <p className={hintCls}>Expose a REST endpoint at <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">http://127.0.0.1:{form.apiServerPort ?? 39400}/api/chat</code> so scripts and CI can send messages.</p>
                {form.apiServerEnabled && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    ✓ API server enabled — <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">POST /api/chat {"{ prompt: string }"}</code>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, apiServerEnabled: !f.apiServerEnabled }))}
                className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors relative mt-0.5 ${form.apiServerEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.apiServerEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {form.apiServerEnabled && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400">Port</label>
                <input
                  type="number"
                  min={1024} max={65535}
                  value={form.apiServerPort ?? 39400}
                  onChange={e => setForm(f => ({ ...f, apiServerPort: parseInt(e.target.value) || 39400 }))}
                  className="w-24 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-blue-400"
                />
              </div>
            )}
          </section>
            </>)}

            {selectedSection === 'integrations' && (<>
          <section className="mb-6">
            <label className={labelCls}>
              GitHub Personal Access Token
              <span className="ml-2 font-normal text-gray-500 dark:text-gray-400 text-xs">Optional</span>
            </label>
            <p className={`${hintCls} mb-2`}>
              Used by the GitHub panel to list and create PRs &amp; issues.
              Create a token at{' '}
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                github.com/settings/tokens
              </a>{' '}
              with <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">repo</code> scope.
            </p>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.githubToken ?? ''}
                onChange={(e) => setForm({ ...form, githubToken: e.target.value })}
                placeholder="ghp_…"
                className={`${inputCls} w-full pr-10 font-mono text-sm`}
              />
              <button
                type="button"
                onClick={() => setShowKey(k => !k)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {form.githubToken ? (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                ✓ GitHub token set — use the GitHub panel to manage PRs &amp; issues
              </p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Without a token, the GitHub panel will use the token you enter there directly
              </p>
            )}
          </section>

          {/* ── Integrations ───────────────────────────────────────────── */}
          <section className="mb-6 border-t border-gray-200 dark:border-gray-800 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">Integrations</p>

            {/* Jira */}
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Jira</p>
            <div className="flex flex-col gap-2 mb-4">
              <input
                type="text"
                placeholder="Jira URL (e.g. https://yourorg.atlassian.net)"
                value={form.jiraUrl ?? ''}
                onChange={e => setForm(f => ({ ...f, jiraUrl: e.target.value }))}
                className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="email"
                placeholder="Jira email"
                value={form.jiraEmail ?? ''}
                onChange={e => setForm(f => ({ ...f, jiraEmail: e.target.value }))}
                className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                placeholder="Jira API token"
                value={form.jiraToken ?? ''}
                onChange={e => setForm(f => ({ ...f, jiraToken: e.target.value }))}
                className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Linear */}
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Linear</p>
            <div className="mb-4">
              <input
                type="password"
                placeholder="Linear API token (lin_api_…)"
                value={form.linearToken ?? ''}
                onChange={e => setForm(f => ({ ...f, linearToken: e.target.value }))}
                className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Webhooks */}
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Webhooks</p>
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, webhookEnabled: !f.webhookEnabled }))}
                  className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors relative ${form.webhookEnabled ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.webhookEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Fire webhook on completion</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">POST to your URL when the AI finishes a response</p>
                </div>
              </div>
              {form.webhookEnabled && (
                <input
                  type="url"
                  placeholder="Webhook URL (https://…)"
                  value={form.webhookUrl ?? ''}
                  onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
                  className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              )}
            </div>

            {/* Docker */}
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Docker Sandbox</p>
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, dockerEnabled: !f.dockerEnabled }))}
                  className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors relative ${form.dockerEnabled ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.dockerEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">Use Docker sandbox</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Run code in isolated containers via run_docker tool</p>
                </div>
              </div>
              {form.dockerEnabled && (
                <input
                  type="text"
                  placeholder="Default image (e.g. node:20-alpine)"
                  value={form.dockerImage ?? ''}
                  onChange={e => setForm(f => ({ ...f, dockerImage: e.target.value }))}
                  className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              )}
            </div>

            {/* Database */}
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Database</p>
            <div className="mb-2">
              <input
                type="text"
                placeholder="Default connection string (sqlite path or postgres://…)"
                value={form.dbConnectionString ?? ''}
                onChange={e => setForm(f => ({ ...f, dbConnectionString: e.target.value }))}
                className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                Used as the default for the query_database tool when no connection is specified
              </p>
            </div>
          </section>
            </>)}

            {/* ── Features section ────────────────────────────────────── */}
            {selectedSection === 'features' && (<>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
              Enable or disable optional panel features. Enabled panels appear in the sidebar. Restart is not required.
            </p>
            {(
              [
                { key: 'dockerManager',   icon: '🐳', label: 'Docker Manager',     desc: 'Manage containers, images and volumes. Requires Docker to be installed.' },
                { key: 'httpBuilder',     icon: '🌐', label: 'HTTP Builder',        desc: 'Postman-style REST client — build and send HTTP requests directly from the app.' },
                { key: 'dependencyAudit', icon: '🔍', label: 'Dependency Audit',    desc: 'Run npm/yarn/pip/cargo audit and see vulnerabilities in your project.' },
                { key: 'testRunner',      icon: '🧪', label: 'Test Runner',         desc: 'Run your test suite and view pass/fail results inline.' },
                { key: 'regexTester',     icon: '🔣', label: 'Regex Tester',        desc: 'Test regular expressions against sample input with live highlighting.' },
                { key: 'dbBrowser',       icon: '🗄️',  label: 'Database Browser',   desc: 'Connect to SQLite or PostgreSQL and run queries.' },
                { key: 'embeddedBrowser', icon: '🔗', label: 'Embedded Browser',    desc: 'Open provider dashboards (Supabase, Vercel, Cloudflare…) in a built-in browser tab.' },
              ] as const
            ).map(feat => (
              <div
                key={feat.key}
                className="flex items-start justify-between gap-4 mb-5 pb-5 border-b border-gray-200 dark:border-gray-800 last:border-0 last:mb-0 last:pb-0"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-2xl leading-none mt-0.5">{feat.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{feat.label}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{feat.desc}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    features: { ...f.features, [feat.key]: !(f.features?.[feat.key]) }
                  }))}
                  className={`flex-shrink-0 w-11 h-6 rounded-full transition-colors relative mt-0.5
                    ${form.features?.[feat.key] ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
                    ${form.features?.[feat.key] ? 'translate-x-5' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>
            ))}
            </>)}

          {/* ── Test result ───────────────────────────────────────────── */}
          {testResult && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              testResult.ok
                ? 'bg-green-50 dark:bg-green-500/10 border border-green-400 dark:border-green-500 text-green-700 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-500/10 border border-red-400 dark:border-red-500 text-red-700 dark:text-red-300'
            }`}>
              {testResult.ok ? '✓ Connection successful!' : `✕ ${testResult.error}`}
            </div>
          )}

          {/* ── Validation errors ────────────────────────────────────── */}
              {validationErrors.length > 0 && (
                <div className="flex flex-col gap-1.5 mb-4">
                  {validationErrors.map((v, i) => (
                    <div key={i} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-xl ${
                      v.level === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                        : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300'
                    }`}>
                      <span className="flex-shrink-0 mt-0.5">{v.level === 'error' ? '✗' : '⚠'}</span>
                      <span>{v.message}</span>
                    </div>
                  ))}
                </div>
              )}

          {/* ── Actions ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
              {/* Import/Export row */}
              <div className="flex items-center gap-2 flex-1">
                <button
                  type="button"
                  onClick={handleExportSettings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors bg-white dark:bg-gray-900"
                  title="Export settings to JSON file"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export
                </button>
                <button
                  type="button"
                  onClick={handleImportSettings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors bg-white dark:bg-gray-900"
                  title="Import settings from JSON file"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Import
                </button>
                {importExportMsg && (
                  <span className={`text-xs ${importExportMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {importExportMsg.text}
                  </span>
                )}
              </div>
            <div className="flex gap-3">
              {hasChanges && (
                <button
                  type="button"
                  onClick={handleRevert}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                  title="Revert all unsaved changes"
                >
                  Revert
                </button>
              )}
            <button
              onClick={handleSave}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors text-sm font-medium"
            >
              Save Settings
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors text-sm"
            >
              Cancel
            </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
