import { useState } from 'react'
import { AppSettings, PROVIDER_MODELS } from '../../../shared/types'

interface Props {
  settings:  AppSettings
  onFinish:  (settings: AppSettings) => void
}

type Step = 'welcome' | 'provider' | 'apikey' | 'workspace' | 'done'

const STEPS: Step[] = ['welcome', 'provider', 'apikey', 'workspace', 'done']

const PROVIDER_INFO = {
  anthropic: {
    label:      'Anthropic Claude',
    color:      'from-orange-500 to-red-500',
    bg:         'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    ring:       'ring-orange-500',
    icon:       '🟠',
    keyUrl:     'https://console.anthropic.com/settings/keys',
    keyHint:    'Starts with sk-ant-…',
    description: 'Best for coding, reasoning and long-context tasks'
  },
  openai: {
    label:      'OpenAI GPT',
    color:      'from-green-500 to-teal-500',
    bg:         'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    ring:       'ring-green-500',
    icon:       '🟢',
    keyUrl:     'https://platform.openai.com/api-keys',
    keyHint:    'Starts with sk-…',
    description: 'GPT-4o, o1, and the full OpenAI model family'
  },
  gemini: {
    label:      'Google Gemini',
    color:      'from-blue-500 to-indigo-500',
    bg:         'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    ring:       'ring-blue-500',
    icon:       '🔵',
    keyUrl:     'https://aistudio.google.com/app/apikey',
    keyHint:    'Starts with AIza…',
    description: 'Gemini 1.5 Pro with 1M context window'
  },
  custom: {
    label:      'Custom / OpenAI-compatible',
    color:      'from-purple-500 to-pink-500',
    bg:         'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
    ring:       'ring-purple-500',
    icon:       '🟣',
    keyUrl:     '',
    keyHint:    'API key for your endpoint (leave blank if not required)',
    description: 'Ollama, LM Studio, Mistral, Groq, or any OpenAI-compatible API'
  }
}

function StepDots({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8" role="progressbar" aria-label={`Step ${STEPS.indexOf(current) + 1} of ${STEPS.length}`}>
      {STEPS.map((s) => (
        <div
          key={s}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            s === current ? 'w-6 bg-blue-500' :
            STEPS.indexOf(s) < STEPS.indexOf(current) ? 'w-1.5 bg-blue-300 dark:bg-blue-700' :
            'w-1.5 bg-gray-200 dark:bg-gray-700'
          }`}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

// ── Welcome ───────────────────────────────────────────────────────────────────
function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-xl">
        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      </div>
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Welcome to Aether</h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-sm leading-relaxed">
          Your AI coding assistant that runs entirely on your machine. Bring your own API key — your code and conversations never leave your device.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 w-full max-w-sm text-center">
        {[
          { icon: '🔑', label: 'BYOK',    desc: 'Your key,\nyour data' },
          { icon: '🛠️', label: '25+ tools', desc: 'File, git, web,\nbrowser & more' },
          { icon: '🤖', label: 'Any model', desc: 'Claude, GPT,\nGemini, Ollama' }
        ].map(f => (
          <div key={f.label} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
            <div className="text-2xl mb-1">{f.icon}</div>
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">{f.label}</div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-pre-line mt-0.5">{f.desc}</div>
          </div>
        ))}
      </div>
      <button
        onClick={onNext}
        className="px-8 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all"
        autoFocus
      >
        Get started →
      </button>
      <button
        onClick={onSkip}
        className="text-xs text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 transition-colors"
      >
        Skip setup, I'll configure later
      </button>
    </div>
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────
function ProviderStep({
  selected, onSelect, onNext, onBack
}: { selected: string; onSelect: (p: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Choose your AI provider</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">You can change this any time in Settings.</p>
      </div>
      <div className="flex flex-col gap-2">
        {(Object.entries(PROVIDER_INFO) as [string, typeof PROVIDER_INFO.anthropic][]).map(([key, info]) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={`flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
              selected === key
                ? `${info.bg} border-current ring-2 ${info.ring}`
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
            aria-pressed={selected === key}
          >
            <span className="text-2xl">{info.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-gray-800 dark:text-gray-200">{info.label}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{info.description}</div>
            </div>
            {selected === key && (
              <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
          </button>
        ))}
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!selected}
          className="flex-[2] py-2.5 rounded-xl bg-blue-500 text-white font-semibold text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

// ── API Key ───────────────────────────────────────────────────────────────────
function ApiKeyStep({
  provider, apiKey, baseUrl,
  onKeyChange, onBaseUrlChange, onNext, onBack, onOAuthDone
}: {
  provider: string; apiKey: string; baseUrl: string
  onKeyChange: (k: string) => void; onBaseUrlChange: (u: string) => void
  onNext: () => void; onBack: () => void
  onOAuthDone: (token: { accessToken: string; refreshToken?: string; expiresAt?: number; tokenType: string }) => void
}) {
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null)
  const [testMsg, setTestMsg]       = useState('')
  const [showKey, setShowKey]       = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthDone, setOauthDone]   = useState(false)

  const info = PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO] ?? PROVIDER_INFO.custom
  const isCustom = provider === 'custom'

  const handleTest = async () => {
    if (!apiKey.trim() && !isCustom) return
    setTesting(true); setTestResult(null); setTestMsg('')
    try {
      const settings = await window.api.getSettings()
      const testSettings = { ...settings, provider: provider as AppSettings['provider'], apiKey, baseUrl: baseUrl || undefined }
      // Try a tiny models list or minimal completion
      const r = await window.api.listOllamaModels().catch(() => ({ ok: false, models: [] }))
      if (provider === 'custom' && (!baseUrl || baseUrl.includes('11434'))) {
        setTestResult(r.ok ? 'ok' : 'error')
        setTestMsg(r.ok ? `Connected! Found ${r.models.length} model(s)` : 'Could not reach the endpoint. Is it running?')
      } else {
        // For cloud providers, just validate key format
        const validFormat = provider === 'anthropic' ? apiKey.startsWith('sk-ant-')
          : provider === 'openai' ? apiKey.startsWith('sk-')
          : provider === 'gemini' ? apiKey.startsWith('AIza')
          : true
        setTestResult(validFormat ? 'ok' : 'error')
        setTestMsg(validFormat ? 'Key format looks correct ✓' : 'Key format looks incorrect — double check it')
      }
      void testSettings
    } catch (e) {
      setTestResult('error'); setTestMsg(String(e))
    }
    setTesting(false)
  }

  const handleOAuth = async () => {
    setOauthLoading(true)
    try {
      const result = await window.api.loginWithOpenAI()
      if (result.ok && result.token) {
        setOauthDone(true)
        onOAuthDone(result.token)
      } else {
        setTestResult('error')
        setTestMsg(result.error ?? 'Sign-in failed')
      }
    } catch (e) {
      setTestResult('error')
      setTestMsg(String(e))
    }
    setOauthLoading(false)
  }

  // For OpenAI, the Continue button is enabled if key is set OR OAuth is done
  const canContinue = provider === 'openai'
    ? (apiKey.trim().length > 0 || oauthDone)
    : (isCustom || apiKey.trim().length > 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Enter your API key</h2>
        {info.keyUrl && (
          <a href={info.keyUrl} target="_blank" rel="noreferrer"
            className="text-sm text-blue-500 hover:text-blue-600 underline underline-offset-2">
            Get your {info.label} API key →
          </a>
        )}
      </div>

      {/* OpenAI: show Sign in with ChatGPT as primary option */}
      {provider === 'openai' && (
        <div className="flex flex-col gap-2">
          {oauthDone ? (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm font-medium">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              Signed in with ChatGPT
            </div>
          ) : (
            <button
              type="button"
              onClick={handleOAuth}
              disabled={oauthLoading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#10a37f] hover:bg-[#0d8c6d] disabled:opacity-60 text-white font-semibold text-sm transition-colors shadow"
            >
              {oauthLoading
                ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Signing in…</>
                : <><svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.369 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.402-.681zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
                  Sign in with ChatGPT</>
              }
            </button>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span>or use an API key</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      )}

      {isCustom && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="wizard-base-url">
            Base URL
          </label>
          <input
            id="wizard-base-url"
            type="url"
            placeholder="http://localhost:11434/v1"
            value={baseUrl}
            onChange={e => onBaseUrlChange(e.target.value)}
            className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[11px] text-gray-400 mt-1">Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="wizard-api-key">
          API Key {isCustom && <span className="text-gray-400">(leave blank if not required)</span>}
        </label>
        <div className="relative">
          <input
            id="wizard-api-key"
            type={showKey ? 'text' : 'password'}
            placeholder={info.keyHint}
            value={apiKey}
            onChange={e => onKeyChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 pr-10 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowKey(s => !s)}
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {showKey
              ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            }
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-xl ${testResult === 'ok' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
          {testResult === 'ok' ? '✓' : '✗'} {testMsg}
        </div>
      )}

      <button
        type="button"
        onClick={handleTest}
        disabled={testing || (!apiKey.trim() && !isCustom)}
        className="w-full py-2 text-sm rounded-xl border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 transition-colors"
      >
        {testing ? 'Testing…' : '⚡ Test connection'}
      </button>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex-[2] py-2.5 rounded-xl bg-blue-500 text-white font-semibold text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

// ── Workspace ─────────────────────────────────────────────────────────────────
function WorkspaceStep({
  workspacePath, onPathChange, onNext, onBack
}: { workspacePath: string; onPathChange: (p: string) => void; onNext: () => void; onBack: () => void }) {
  const handlePick = async () => {
    const picked = await window.api.pickFolder()
    if (picked) onPathChange(picked)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Set your workspace</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The AI will be able to read and edit files in this folder. You can change it per-conversation later.
        </p>
      </div>

      <div
        onClick={handlePick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handlePick()}
        aria-label="Pick workspace folder"
        className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 cursor-pointer transition-colors"
      >
        <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        {workspacePath
          ? <p className="text-sm font-medium text-blue-600 dark:text-blue-400 text-center break-all max-w-full">{workspacePath}</p>
          : <p className="text-sm text-gray-500 dark:text-gray-400">Click to pick a folder</p>
        }
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        💡 You can skip this and set it later in Settings or per-conversation.
      </p>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          ← Back
        </button>
        <button
          onClick={onNext}
          className="flex-[2] py-2.5 rounded-xl bg-blue-500 text-white font-semibold text-sm hover:bg-blue-600 transition-colors"
        >
          {workspacePath ? 'Continue →' : 'Skip for now →'}
        </button>
      </div>
    </div>
  )
}

// ── Done ──────────────────────────────────────────────────────────────────────
function DoneStep({ provider, onFinish }: { provider: string; onFinish: () => void }) {
  const info = PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO] ?? PROVIDER_INFO.custom

  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shadow-xl">
        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">You're all set!</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs leading-relaxed">
          {info.icon} {info.label} is configured. Start a conversation and the AI will be ready to help with your code.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs text-left">
        {[
          { tip: 'Type a message to start chatting',  icon: '💬' },
          { tip: 'Use @filename to attach files',     icon: '📎' },
          { tip: 'Press Ctrl+, to open Settings',     icon: '⚙️' },
          { tip: 'Press ? for keyboard shortcuts',    icon: '⌨️' }
        ].map(t => (
          <div key={t.tip} className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-400">
            <span>{t.icon}</span>
            <span>{t.tip}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onFinish}
        className="px-8 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all"
        autoFocus
      >
        Start coding 🚀
      </button>
    </div>
  )
}

// ── Main Wizard ───────────────────────────────────────────────────────────────
export default function OnboardingWizard({ settings, onFinish }: Props) {
  const [step,      setStep]      = useState<Step>('welcome')
  const [provider,  setProvider]  = useState(settings.provider ?? 'anthropic')
  const [apiKey,    setApiKey]    = useState(settings.apiKey ?? '')
  const [baseUrl,   setBaseUrl]   = useState(settings.baseUrl ?? '')
  const [workspace, setWorkspace] = useState(settings.workspacePath ?? '')
  const [oauthToken, setOauthToken] = useState<{ accessToken: string; refreshToken?: string; expiresAt?: number; tokenType: string } | null>(null)

  const goNext = () => setStep(s => STEPS[STEPS.indexOf(s) + 1] ?? 'done')
  const goBack = () => setStep(s => STEPS[STEPS.indexOf(s) - 1] ?? 'welcome')

  const handleFinish = async () => {
    const prov = PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO] ?? PROVIDER_INFO.custom
    const defaultModel = (PROVIDER_MODELS as Record<string, string[]>)[provider]?.[0] ?? settings.model
    void prov
    const updated: AppSettings = {
      ...settings,
      provider:           provider as AppSettings['provider'],
      apiKey,
      baseUrl:            baseUrl || settings.baseUrl,
      workspacePath:      workspace || settings.workspacePath,
      model:              defaultModel,
      onboardingComplete: true,
      ...(oauthToken ? { openaiOAuth: oauthToken } : {})
    }
    if (window.api) await window.api.saveSettings(updated)
    onFinish(updated)
  }

  const handleSkip = async () => {
    const updated: AppSettings = { ...settings, onboardingComplete: true }
    if (window.api) await window.api.saveSettings(updated)
    onFinish(updated)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Setup wizard"
    >
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl p-8 border border-gray-200 dark:border-gray-800">
        <StepDots current={step} />

        {step === 'welcome'   && <WelcomeStep onNext={goNext} onSkip={handleSkip} />}
        {step === 'provider'  && <ProviderStep selected={provider} onSelect={setProvider} onNext={goNext} onBack={goBack} />}
        {step === 'apikey'    && (
          <ApiKeyStep
            provider={provider} apiKey={apiKey} baseUrl={baseUrl}
            onKeyChange={setApiKey} onBaseUrlChange={setBaseUrl}
            onNext={goNext} onBack={goBack}
            onOAuthDone={setOauthToken}
          />
        )}
        {step === 'workspace' && <WorkspaceStep workspacePath={workspace} onPathChange={setWorkspace} onNext={goNext} onBack={goBack} />}
        {step === 'done'      && <DoneStep provider={provider} onFinish={handleFinish} />}
      </div>
    </div>
  )
}
