import { useState, useEffect, useCallback } from 'react'
import { AgentPreset, AppSettings, PROVIDER_MODELS } from '../../../shared/types'

interface Props {
  settings:  AppSettings
  onApply:   (preset: AgentPreset) => void
  onClose:   () => void
}

const isElectron = typeof window !== 'undefined' && !!window.api

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    anthropic: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    openai:    'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    gemini:    'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    custom:    'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[provider] ?? colors.custom}`}>
      {provider}
    </span>
  )
}

export default function AgentPresetsPanel({ settings, onApply, onClose }: Props) {
  const [presets,    setPresets]    = useState<AgentPreset[]>([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [newName,    setNewName]    = useState('')
  const [showSave,   setShowSave]   = useState(false)
  const [deleteConf, setDeleteConf] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isElectron) { setLoading(false); return }
    setLoading(true)
    const list = await window.api.listPresets()
    setPresets(list)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!newName.trim() || !isElectron) return
    setSaving(true)
    const preset: AgentPreset = {
      id:           genId(),
      name:         newName.trim(),
      provider:     settings.provider,
      model:        settings.model,
      systemPrompt: settings.systemPrompt,
      maxTokens:    settings.maxTokens,
      temperature:  settings.temperature,
      topP:         settings.topP,
      createdAt:    Date.now()
    }
    await window.api.savePreset(preset)
    setNewName('')
    setShowSave(false)
    await load()
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!isElectron) return
    await window.api.deletePreset(id)
    setDeleteConf(null)
    await load()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700
                      w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Agent Presets</h2>
            <span className="text-[10px] text-gray-400 dark:text-gray-600">{presets.length} saved</span>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Save current as preset */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          {!showSave ? (
            <button
              onClick={() => setShowSave(true)}
              className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Save current settings as preset
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setShowSave(false); setNewName('') } }}
                placeholder="Preset name…"
                className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400 text-gray-900 dark:text-gray-100"
              />
              <button
                onClick={handleSave}
                disabled={!newName.trim() || saving}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setShowSave(false); setNewName('') }}
                className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          {/* Current settings hint */}
          <div className="flex items-center gap-2 mt-1.5">
            <ProviderBadge provider={settings.provider} />
            <span className="text-[10px] text-gray-400 dark:text-gray-600">{settings.model}</span>
            {settings.temperature !== undefined && (
              <span className="text-[10px] text-gray-400 dark:text-gray-600">T={settings.temperature.toFixed(2)}</span>
            )}
          </div>
        </div>

        {/* Preset list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 text-sm">Loading…</div>
          ) : presets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
              <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="text-sm">No presets yet</p>
              <p className="text-xs">Save your current settings above to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {presets.map(preset => (
                <div key={preset.id} className="group px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{preset.name}</span>
                        <ProviderBadge provider={preset.provider} />
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-600">
                        <span>{preset.model}</span>
                        <span>·</span>
                        <span>{preset.maxTokens.toLocaleString()} tokens</span>
                        {preset.temperature !== undefined && <><span>·</span><span>T={preset.temperature.toFixed(2)}</span></>}
                        {preset.topP !== undefined && <><span>·</span><span>P={preset.topP.toFixed(2)}</span></>}
                      </div>
                      {preset.systemPrompt && (
                        <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-600 truncate">
                          {preset.systemPrompt.slice(0, 80)}{preset.systemPrompt.length > 80 ? '…' : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {deleteConf === preset.id ? (
                        <>
                          <button onClick={() => handleDelete(preset.id)}
                                  className="px-2 py-1 rounded text-[10px] bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800 transition-colors">
                            Delete
                          </button>
                          <button onClick={() => setDeleteConf(null)}
                                  className="px-2 py-1 rounded text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onApply(preset)}
                            className="px-2.5 py-1 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                          >
                            Apply
                          </button>
                          <button
                            onClick={() => setDeleteConf(preset.id)}
                            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
