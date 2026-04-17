import {
  useState, useRef, useEffect, useLayoutEffect, useCallback,
  forwardRef, useImperativeHandle,
  KeyboardEvent, DragEvent
} from 'react'
import React from 'react'
import ReactDOM from 'react-dom'
import { AppSettings, Conversation, ChatMessage, ConversationMode, ImageAttachment, ImageMimeType, PROVIDER_MODELS, PROVIDER_BASE_URLS, Provider, ProjectConfig, supportsReasoningDepth } from '../../../shared/types'
import { PROMPT_TEMPLATES, findMatchingTemplate } from '../utils/promptTemplates'
import MessageBubble from './MessageBubble'
import FileMentionDropdown from './FileMentionDropdown'
import MemoryPanel from './MemoryPanel'
import ProjectSummaryPanel from './ProjectSummaryPanel'
import PromptLibrary from './PromptLibrary'
import PinnedFilesPanel from './PinnedFilesPanel'
import FileEditorModal from './FileEditorModal'
import TaskQueuePanel from './TaskQueuePanel'
import ContextTokenBar, { ContextCircle } from './ContextTokenBar'
import ModeTabBar from './ModeTabBar'
import AgentProgressPanel from './AgentProgressPanel'
import ActivityPanel from './ActivityPanel'
import VoiceRecorder from './VoiceRecorder'
import ReviewPanel from './ReviewPanel'
import PairModePanel from './PairModePanel'
import { useChat } from '../hooks/useChat'
import { estimateTokens, estimateCost, formatTokens, formatCost, hasKnownPricing, getContextWarning } from '../utils/tokenCost'

const isElectron = typeof window !== 'undefined' && !!window.api

// ── Public handle (for parent to call focusInput via ref) ─────────────────────
export interface ChatWindowHandle {
  focusInput: () => void
}

// ── File attachment types ─────────────────────────────────────────────────────
interface AttachedFile {
  id:       string
  name:     string
  content:  string
  size:     number
  language: string
}

// @-mention file
interface MentionFile {
  id:       string
  path:     string   // relative path within workspace
  name:     string   // basename
  content:  string
  language: string
}

// Image attachment (vision)
interface AttachedImage {
  id:         string
  name:       string
  mimeType:   ImageMimeType
  data:       string   // base64, no data-URI prefix
  previewUrl: string   // data:image/...;base64,... for <img> src
  size:       number
}

interface Props {
  conversation:          Conversation | null
  settings:              AppSettings
  onConversationUpdate:  (conv: Conversation) => void
  onSettingsUpdate?:     (settings: AppSettings) => void
  onNew?:                () => void
  onOpenSearch?:         () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE  = 200 * 1024
const MAX_FILES      = 8
const MAX_IMAGE_SIZE = 5 * 1024 * 1024   // 5 MB per image
const MAX_IMAGES     = 4
const IMAGE_MIME_TYPES: ImageMimeType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function isImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.includes(file.type as ImageMimeType)
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx',  js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript',
  py: 'python',     rb: 'ruby',  rs: 'rust',        go: 'go',
  java: 'java',     kt: 'kotlin', swift: 'swift',   cs: 'csharp',
  cpp: 'cpp',       c: 'c',       h: 'c',            hpp: 'cpp',
  php: 'php',
  json: 'json',     yaml: 'yaml', yml: 'yaml',      toml: 'toml',
  xml: 'xml',       html: 'html', css: 'css',       scss: 'scss',
  sql: 'sql',       sh: 'bash',   bash: 'bash',     zsh: 'bash',
  md: 'markdown',   mdx: 'markdown', txt: 'text',   env: 'bash',
  csv: 'text',      graphql: 'graphql', proto: 'protobuf', prisma: 'prisma',
}
const ACCEPTED_EXTENSIONS = Object.keys(EXT_LANG).map(e => `.${e}`).join(',')
function getLang(filename: string): string {
  return EXT_LANG[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'text'
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── File chip (blue — drag-and-drop / browse) ─────────────────────────────────
function FileChip({ file, onRemove }: { file: AttachedFile; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg px-2.5 py-1.5 text-xs">
      <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span className="text-blue-700 dark:text-blue-300 font-medium max-w-[140px] truncate">{file.name}</span>
      <span className="text-blue-400 dark:text-blue-500">{formatBytes(file.size)}</span>
      <button onClick={onRemove} className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors" title="Remove">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ── Mention chip (purple — @-mention) ─────────────────────────────────────────
function MentionChip({ file, onRemove }: { file: MentionFile; onRemove: () => void }) {
  return (
    <div
      className="flex items-center gap-1.5 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg px-2.5 py-1.5 text-xs"
      title={file.path}
    >
      <span className="text-purple-500 dark:text-purple-400 font-bold text-[10px] leading-none">@</span>
      <span className="text-purple-700 dark:text-purple-300 font-medium max-w-[160px] truncate">{file.name}</span>
      <button onClick={onRemove} className="ml-0.5 text-purple-400 hover:text-red-500 transition-colors" title="Remove mention">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ── Image chip (green — pasted / dragged image) ───────────────────────────────
function ImageChip({ image, onRemove }: { image: AttachedImage; onRemove: () => void }) {
  return (
    <div
      className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg pl-1 pr-2 py-1 text-xs"
      title={image.name}
    >
      {/* Thumbnail */}
      <img
        src={image.previewUrl}
        alt={image.name}
        className="w-8 h-8 rounded-md object-cover flex-shrink-0 bg-white/20"
      />
      <div className="flex flex-col min-w-0">
        <span className="text-emerald-700 dark:text-emerald-300 font-medium max-w-[120px] truncate leading-tight">
          {image.name}
        </span>
        <span className="text-emerald-500 dark:text-emerald-600 leading-tight">{formatBytes(image.size)}</span>
      </div>
      <button onClick={onRemove} className="ml-0.5 text-emerald-400 hover:text-red-500 transition-colors flex-shrink-0" title="Remove image">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ── Export helpers ────────────────────────────────────────────────────────────
function buildMarkdown(title: string, messages: { role: string; content: string }[]): string {
  const lines = [
    `# ${title}`,
    `_Exported from AI Code App · ${new Date().toLocaleString()}_`,
    ''
  ]
  messages.forEach((m) => {
    if (m.role === 'user') {
      lines.push('---', '**You**', '', m.content, '')
    } else if (m.role === 'assistant') {
      lines.push('---', '**Assistant**', '', m.content, '')
    }
  })
  return lines.join('\n')
}

function buildText(title: string, messages: { role: string; content: string }[]): string {
  const lines = [
    title,
    `Exported: ${new Date().toLocaleString()}`,
    '='.repeat(60),
    ''
  ]
  messages.forEach((m) => {
    const who = m.role === 'user' ? 'You' : 'Assistant'
    lines.push(`[${who}]`, m.content, '')
  })
  return lines.join('\n')
}

// ── Model picker (cross-provider) ────────────────────────────────────────────
const PROVIDER_ICONS: Record<string, string> = {
  anthropic: '◆',
  openai:    '⬡',
  gemini:    '✦',
  nvidia:    '⬥',
  custom:    '⚙',
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai:    'OpenAI',
  gemini:    'Google Gemini',
  nvidia:    'NVIDIA NIM',
  custom:    'Custom / Local',
}

function modelShortName(m: string, provider: string): string {
  if (provider === 'anthropic')
    return m.replace(/^claude-/, '').replace(/-(\d)/g, ' $1').replace(/-/g, ' ')
      .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  if (provider === 'openai')
    return m.replace(/^gpt-/, 'GPT-').replace(/-turbo$/, ' Turbo').replace(/-mini$/, ' Mini')
  if (provider === 'gemini')
    return m.replace(/^gemini-/, '').replace(/-preview[-\d]+$/, ' preview').replace(/-\d{3}$/, '').replace(/-/g, ' ')
      .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  if (provider === 'nvidia') {
    const base = m.includes('/') ? m.split('/')[1] : m
    return base.replace(/-instruct$/, '').replace(/-chat$/, '').replace(/-/g, ' ')
      .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  }
  return m
}

function ModelPicker({
  settings, onApply, openUp = false
}: {
  settings: AppSettings
  onApply: (model: string, provider: Provider) => void
  openUp?: boolean
}) {
  const [open, setOpen]         = useState(false)
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const ref        = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const portalRef  = useRef<HTMLDivElement>(null)
  const searchRef  = useRef<HTMLInputElement>(null)

  // Build the full provider+model catalogue
  const builtInProviders: Provider[] = ['anthropic', 'openai', 'gemini', 'nvidia']
  const customProviders = settings.customProviders ?? []

  // Expand the active provider by default when opening
  useEffect(() => {
    if (!open) { setSearch(''); setDropdownPos(null); return }
    setExpanded({ [settings.provider]: true })
    setTimeout(() => searchRef.current?.focus(), 50)
    // Compute fixed position from the trigger button
    if (triggerRef.current) {
      const rect       = triggerRef.current.getBoundingClientRect()
      const dropW      = Math.max(rect.width, 320)
      const spaceAbove = rect.top - 8
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const goUp       = openUp ? spaceAbove >= 150 : spaceBelow < 150
      const maxHeight  = Math.min(goUp ? spaceAbove : spaceBelow, 480)
      const top        = goUp ? rect.top - maxHeight - 4 : rect.bottom + 4
      // Clamp left so the dropdown doesn't overflow the right edge
      const left       = Math.min(rect.left, window.innerWidth - dropW - 8)
      setDropdownPos({ top, left, width: dropW, maxHeight })
    }
    // Close on outside click — must check BOTH the trigger wrapper AND the portal
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      const insideTrigger = ref.current?.contains(target)
      const insidePortal  = portalRef.current?.contains(target)
      if (!insideTrigger && !insidePortal) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const q = search.toLowerCase().trim()

  // When searching, expand all sections that have a match
  const providerMatches = (provider: string, models: string[]) =>
    !q || models.some(m => m.toLowerCase().includes(q) || modelShortName(m, provider).toLowerCase().includes(q))

  const filterModels = (models: string[]) =>
    q ? models.filter(m => m.toLowerCase().includes(q) || modelShortName(m, 'nvidia').toLowerCase().includes(q)) : models

  const icon      = PROVIDER_ICONS[settings.provider] ?? '◈'
  const shortName = modelShortName(settings.model, settings.provider)
  const isSearching = q.length > 0

  const ModelRow = ({ m, provider, onSelect }: { m: string; provider: string; onSelect: () => void }) => {
    const isActive = m === settings.model && provider === settings.provider
    return (
      <button
        onClick={onSelect}
        className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-left transition-colors
          hover:bg-gray-50 dark:hover:bg-gray-800/60
          ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
      >
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
            {modelShortName(m, provider)}
          </p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">{m}</p>
        </div>
        {isActive && (
          <svg className="w-3 h-3 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
    )
  }

  const SectionHeader = ({ provider, label, count }: { provider: string; label: string; count: number }) => {
    const isOpen = isSearching || expanded[provider]
    return (
      <button
        onClick={() => !isSearching && setExpanded(e => ({ ...e, [provider]: !e[provider] }))}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors group"
      >
        <span className="text-sm text-gray-500 dark:text-gray-400 w-4 text-center flex-shrink-0">
          {PROVIDER_ICONS[provider] ?? '◈'}
        </span>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-1">{label}</span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">{count}</span>
        {!isSearching && (
          <svg className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
    )
  }

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        title="Switch model or provider"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                   text-gray-500 dark:text-gray-400
                   hover:text-gray-800 dark:hover:text-gray-100
                   hover:bg-gray-100 dark:hover:bg-gray-800
                   border border-transparent hover:border-gray-200 dark:hover:border-gray-700
                   transition-all group"
      >
        <span className="text-gray-400 dark:text-gray-500 group-hover:text-blue-500 transition-colors">{icon}</span>
        <span className="max-w-[160px] truncate">{shortName || settings.model}</span>
        <span className="text-gray-300 dark:text-gray-600 text-[10px]">{PROVIDER_LABELS[settings.provider] ?? settings.provider}</span>
        <svg className={`w-2.5 h-2.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && dropdownPos && ReactDOM.createPortal(
        <div
          ref={portalRef}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{
            position:  'fixed',
            top:       dropdownPos.top,
            left:      dropdownPos.left,
            width:     dropdownPos.width,
            maxHeight: dropdownPos.maxHeight,
            zIndex:    9999,
          }}
        >
          {/* Search bar */}
          <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-2.5 py-1.5">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search across all providers…"
                className="flex-1 bg-transparent text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Provider sections */}
          <div className="overflow-y-auto flex-1">

            {/* ── Built-in providers ── */}
            {builtInProviders.map(provider => {
              const models = PROVIDER_MODELS[provider] ?? []
              const visible = filterModels(models)
              if (!providerMatches(provider, models)) return null
              const isOpen = isSearching || expanded[provider]

              return (
                <div key={provider} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <SectionHeader provider={provider} label={PROVIDER_LABELS[provider]} count={models.length} />
                  {isOpen && (
                    <div className="pb-1">
                      {visible.map(m => (
                        <ModelRow
                          key={m} m={m} provider={provider}
                          onSelect={() => { onApply(m, provider); setOpen(false) }}
                        />
                      ))}
                      {visible.length === 0 && q && (
                        <p className="text-[11px] text-gray-400 pl-7 pb-2">No matches</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* ── Custom providers ── */}
            {customProviders.length > 0 && (
              <div className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <SectionHeader provider="custom" label="Custom / Local" count={customProviders.length} />
                {(isSearching || expanded['custom']) && (
                  <div className="pb-1">
                    {customProviders
                      .filter(cp => !q || cp.name.toLowerCase().includes(q) || cp.model.toLowerCase().includes(q))
                      .map(cp => {
                        const isActive = settings.provider === 'custom' && settings.selectedCustomProviderId === cp.id
                        return (
                          <button
                            key={cp.id}
                            onClick={() => {
                              onApply(cp.model, 'custom')
                              setOpen(false)
                            }}
                            className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-left transition-colors
                              hover:bg-gray-50 dark:hover:bg-gray-800/60
                              ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                                {cp.name}
                              </p>
                              <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                {cp.model || 'no default model'} · {cp.baseUrl}
                              </p>
                            </div>
                            {isActive && (
                              <svg className="w-3 h-3 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        )
                      })}
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {q && builtInProviders.every(p => !providerMatches(p, PROVIDER_MODELS[p] ?? [])) && customProviders.length === 0 && (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">No models match "{search}"</p>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
            <p className="text-[10px] text-gray-400 dark:text-gray-600">
              Switching provider mid-conversation uses the API key from Settings
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Reasoning depth picker ───────────────────────────────────────────────────
const DEPTH_CONFIG = {
  off:    { label: 'Off',    icon: '◌', color: 'text-gray-400 dark:text-gray-500',              desc: 'No extended thinking'             },
  low:    { label: 'Low',    icon: '○', color: 'text-blue-400 dark:text-blue-500',              desc: 'Quick reasoning pass'              },
  medium: { label: 'Med',   icon: '◎', color: 'text-blue-500 dark:text-blue-400',              desc: 'Balanced depth'                   },
  high:   { label: 'High',  icon: '●', color: 'text-violet-500 dark:text-violet-400',          desc: 'Deep multi-step reasoning (slow)' },
} as const

type DepthKey = keyof typeof DEPTH_CONFIG

function ReasoningDepthPicker({
  provider, model, depth, onChange
}: {
  provider: string
  model:    string
  depth:    DepthKey
  onChange: (d: DepthKey) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!supportsReasoningDepth(provider, model)) return null

  const cfg = DEPTH_CONFIG[depth]

  // Provider-specific budget label
  const budgetLabel = (d: DepthKey) => {
    if (d === 'off') return 'disabled'
    if (provider === 'anthropic') {
      const tokens: Record<DepthKey, string> = { off: '—', low: '1k tokens', medium: '8k tokens', high: '16k tokens' }
      return tokens[d]
    }
    if (provider === 'openai') return `effort: ${d}`
    if (provider === 'gemini') {
      const budget: Record<DepthKey, string> = { off: '0', low: '512', medium: '4k', high: '16k' }
      return `${budget[d]} think tokens`
    }
    return d
  }

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`Reasoning depth: ${cfg.label} — ${cfg.desc}`}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium
                    border border-transparent hover:border-gray-200 dark:hover:border-gray-700
                    hover:bg-gray-100 dark:hover:bg-gray-800 transition-all ${cfg.color}`}
      >
        <span>{cfg.icon}</span>
        <span>{cfg.label}</span>
        <svg className={`w-2.5 h-2.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Reasoning Depth
            </p>
            <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">
              {provider === 'anthropic' && 'Extended thinking — budget tokens'}
              {provider === 'openai'    && 'Reasoning effort (o-series models)'}
              {provider === 'gemini'    && 'Thinking budget tokens (Gemini 2.5+)'}
            </p>
          </div>
          <div className="py-1">
            {(Object.keys(DEPTH_CONFIG) as DepthKey[]).map(d => {
              const c = DEPTH_CONFIG[d]
              const active = d === depth
              return (
                <button
                  key={d}
                  onClick={() => { onChange(d); setOpen(false) }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                    hover:bg-gray-50 dark:hover:bg-gray-800/60
                    ${active ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                >
                  <span className={`text-base w-5 text-center flex-shrink-0 ${c.color}`}>{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                      {c.label}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">{c.desc} · {budgetLabel(d)}</p>
                  </div>
                  {active && (
                    <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Quick template menu (chat header) ────────────────────────────────────────
function QuickTemplateMenu({
  currentPrompt, onApply
}: { currentPrompt: string; onApply: (prompt: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = findMatchingTemplate(currentPrompt)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
          active
            ? 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
            : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        title="Switch prompt template"
      >
        <span className="text-sm leading-none">{active?.icon ?? '⚡'}</span>
        <span className="hidden sm:inline">{active?.name ?? 'Template'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Prompt Template</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {PROMPT_TEMPLATES.map(t => {
              const isActive = t.prompt.trim() === currentPrompt.trim()
              return (
                <button
                  key={t.id}
                  onClick={() => { onApply(t.prompt); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                    isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                      {t.name}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">{t.description}</p>
                  </div>
                  {isActive && (
                    <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Export dropdown ───────────────────────────────────────────────────────────
function ExportMenu({
  title, messages, disabled
}: {
  title: string
  messages: { role: string; content: string }[]
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const doExport = async (format: 'md' | 'txt') => {
    setOpen(false)
    if (!isElectron || messages.length === 0) return
    const content  = format === 'md' ? buildMarkdown(title, messages) : buildText(title, messages)
    const safeName = title.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-') || 'chat'
    await window.api.exportChat({ defaultName: safeName, content, format })
  }

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200
                   hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Export conversation"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Export
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                        rounded-lg shadow-lg py-1 z-50 text-sm">
          <button
            onClick={() => doExport('md')}
            className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300 flex items-center gap-2"
          >
            <span className="text-base">📝</span> Markdown (.md)
          </button>
          <button
            onClick={() => doExport('txt')}
            className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300 flex items-center gap-2"
          >
            <span className="text-base">📄</span> Plain text (.txt)
          </button>
        </div>
      )}
    </div>
  )
}

// ── Windowed message list ────────────────────────────────────────────────────
const PAGE_SIZE = 80

interface MessageListProps {
  messages:       ChatMessage[]
  settings:       AppSettings
  isStreaming:    boolean
  messagesEndRef: React.RefObject<HTMLDivElement>
  editMessage:    (id: string, content: string) => void
  handleBranch:   (messageId: string) => void
  rateMessage:    (id: string, rating: 'up' | 'down') => void
  setEditorFile:  (path: string) => void
}

function MessageList({ messages, settings, isStreaming, messagesEndRef, editMessage, handleBranch, rateMessage, setEditorFile }: MessageListProps) {
  const [visibleStart, setVisibleStart] = useState(() => Math.max(0, messages.length - PAGE_SIZE))

  useEffect(() => {
    // When new messages are added at the end (streaming/send), show them
    const newStart = Math.max(0, messages.length - PAGE_SIZE)
    if (newStart > visibleStart) setVisibleStart(newStart)
  }, [messages.length, visibleStart])

  const visibleMessages = messages.slice(visibleStart)
  const hiddenCount     = visibleStart

  return (
    <>
      {hiddenCount > 0 && (
        <div className="flex justify-center py-3">
          <button
            onClick={() => setVisibleStart(s => Math.max(0, s - PAGE_SIZE))}
            className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 px-4 py-1.5 rounded-full transition-colors"
            aria-label={`Load earlier messages. ${hiddenCount} messages hidden.`}
          >
            ↑ Load {Math.min(PAGE_SIZE, hiddenCount)} earlier messages ({hiddenCount} hidden)
          </button>
        </div>
      )}
      {visibleMessages.map((msg, idx) => {
        const absoluteIdx = visibleStart + idx
        const isLastAI = msg.role === 'assistant' && absoluteIdx === messages.length - 1 && !msg.isStreaming
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            settings={settings}
            isLastAI={isLastAI}
            chatStreaming={isStreaming}
            onEdit={editMessage}
            onRegenerate={(aiMsgId) => {
              const aiIdx   = messages.findIndex(m => m.id === aiMsgId)
              const userMsg = [...messages.slice(0, aiIdx)].reverse().find(m => m.role === 'user')
              if (userMsg) editMessage(userMsg.id, userMsg.content)
            }}
            onBranch={handleBranch}
            onRate={rateMessage}
            onOpenFile={settings.workspacePath ? (path) => setEditorFile(path) : undefined}
          />
        )
      })}
      <div ref={messagesEndRef} />
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const ChatWindow = forwardRef<ChatWindowHandle, Props>(function ChatWindow(
  { conversation, settings, onConversationUpdate, onSettingsUpdate, onNew, onOpenSearch }, ref
) {
  const [input,           setInput]           = useState(() => {
    try { return localStorage.getItem(`draft-${conversation?.id ?? 'new'}`) ?? '' } catch { return '' }
  })
  const [attachedFiles,   setAttachedFiles]   = useState<AttachedFile[]>([])
  const [attachedImages,  setAttachedImages]  = useState<AttachedImage[]>([])
  const [isDragging,      setIsDragging]      = useState(false)
  const [fileError,       setFileError]       = useState<string | null>(null)
  const [memoryOpen,      setMemoryOpen]      = useState(false)
  const [summaryOpen,     setSummaryOpen]     = useState(false)
  const [promptLibOpen,   setPromptLibOpen]   = useState(false)
  const [pinsOpen,        setPinsOpen]        = useState(false)
  const [pinsCount,       setPinsCount]       = useState(0)
  const [projectConfig,   setProjectConfig]   = useState<ProjectConfig | null>(null)
  const [detectedUrls,    setDetectedUrls]    = useState<string[]>([])
  const [urlBannerDismissed, setUrlBannerDismissed] = useState(false)
  // Voice input
  const [isListening,     setIsListening]     = useState(false)
  // Inline file editor
  const [editorFile,      setEditorFile]      = useState<string | null>(null)
  // Task queue
  const [queueOpen,       setQueueOpen]       = useState(false)
  // Custom plugins
  const [pluginsCount,    setPluginsCount]    = useState(0)
  const [ragChunks,       setRagChunks]       = useState(0)

  // @-mention state
  const [mentionQuery,   setMentionQuery]   = useState<string | null>(null)  // null = inactive
  const [mentionAnchor,  setMentionAnchor]  = useState(0)                    // index of '@' in input
  const [mentionFiles,   setMentionFiles]   = useState<string[]>([])          // cached workspace paths
  const [mentionChips,   setMentionChips]   = useState<MentionFile[]>([])    // attached via @

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const dragCounter    = useRef(0)

  const [mode, setMode] = useState<ConversationMode>(conversation?.mode ?? 'code')
  const [activityOpen, setActivityOpen] = useState(false)

  const handleModeChange = useCallback((newMode: ConversationMode) => {
    setMode(newMode)
    if (conversation) {
      const updated = { ...conversation, mode: newMode }
      window.api.saveConversation(updated)
      onConversationUpdate(updated)
    }
  }, [conversation, onConversationUpdate])

  // Sync mode when switching conversations
  useEffect(() => {
    setMode(conversation?.mode ?? 'code')
  }, [conversation?.id])

  const {
    messages, isStreaming, isCompressing, sendMessage, editMessage,
    abortStream, rateMessage, effectiveSettings,
    autoContinueCount, agentPaused, pauseAgent, resumeAgent, maxAutoContiues
  } = useChat({
    conversation, settings, onConversationUpdate, mode
  })

  // Expose focusInput to parent (keyboard shortcut Ctrl+/)
  useImperativeHandle(ref, () => ({
    focusInput: () => textareaRef.current?.focus()
  }))

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea: 1 line by default, grows up to 5 lines.
  // useLayoutEffect fires synchronously before paint — no visible flash or jump.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'   // rows={1} anchors the 1-line minimum
    const cs  = getComputedStyle(el)
    const lh  = parseFloat(cs.lineHeight)  || 20
    const pv  = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    const maxH = lh * 5 + pv                // 5 lines + textarea's own vertical padding
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px'
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [input])

  // ── Draft auto-save ──────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const key = `draft-${conversation?.id ?? 'new'}`
      if (input) localStorage.setItem(key, input)
      else       localStorage.removeItem(key)
    } catch { /* ignore quota errors */ }
  }, [input, conversation?.id])

  // Load draft when switching conversations
  useEffect(() => {
    try {
      setInput(localStorage.getItem(`draft-${conversation?.id ?? 'new'}`) ?? '')
    } catch { setInput('') }
  }, [conversation?.id])

  // Detect URLs in the input and show a banner
  useEffect(() => {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
    const found = input.match(urlRegex) ?? []
    // deduplicate
    const unique = [...new Set(found)]
    setDetectedUrls(unique)
    if (unique.length === 0) setUrlBannerDismissed(false)
  }, [input])

  // Auto-dismiss file error
  useEffect(() => {
    if (!fileError) return
    const t = setTimeout(() => setFileError(null), 4000)
    return () => clearTimeout(t)
  }, [fileError])

  // ── @-mention: load workspace file list (once, lazily) ───────────────────
  const loadMentionFiles = useCallback(async () => {
    if (!isElectron || !settings.workspacePath || mentionFiles.length > 0) return
    try {
      const files = await window.api.listWorkspaceFiles(settings.workspacePath)
      setMentionFiles(files)
    } catch { /* silently ignore — mentions just won't work */ }
  }, [settings.workspacePath, mentionFiles.length])

  // Refresh mention file list when workspace changes
  useEffect(() => {
    setMentionFiles([])
  }, [settings.workspacePath])

  // Load .chatui project config when workspace changes
  useEffect(() => {
    if (!isElectron || !settings.workspacePath) { setProjectConfig(null); return }
    window.api.getProjectConfig(settings.workspacePath).then(cfg => setProjectConfig(cfg))
  }, [settings.workspacePath])

  // Load pins count when workspace changes
  useEffect(() => {
    if (!isElectron || !settings.workspacePath) { setPinsCount(0); return }
    window.api.readPins(settings.workspacePath).then(({ pins }) => setPinsCount(pins.length))
  }, [settings.workspacePath])

  // Load plugin count when workspace changes
  useEffect(() => {
    if (!isElectron || !settings.workspacePath) { setPluginsCount(0); return }
    window.api.listPlugins(settings.workspacePath).then(p => setPluginsCount(p.length)).catch(() => setPluginsCount(0))
  }, [settings.workspacePath])

  // ── Scheduled task fire ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt
      if (!prompt) return
      sendMessage(prompt)
    }
    window.addEventListener('schedule-fire-prompt', handler)
    return () => window.removeEventListener('schedule-fire-prompt', handler)
  }, [sendMessage])

  // ── RAG injection indicator ─────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return
    window.api.onRagInjected(({ chunks }) => {
      setRagChunks(chunks)
      // Auto-clear after 8s
      setTimeout(() => setRagChunks(0), 8000)
    })
  }, [])

  // ── Voice input (Web Speech API) ──────────────────────────────────────────
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof globalThis.SpeechRecognition; webkitSpeechRecognition?: typeof globalThis.SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { SpeechRecognition?: typeof globalThis.SpeechRecognition; webkitSpeechRecognition?: typeof globalThis.SpeechRecognition }).webkitSpeechRecognition
    if (!SpeechRecognition) { alert('Speech recognition is not supported in this browser.'); return }

    const rec = new SpeechRecognition()
    rec.continuous       = true
    rec.interimResults   = true
    rec.lang             = 'en-US'
    recognitionRef.current = rec

    let finalTranscript = ''
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) finalTranscript += result[0].transcript
        else interim += result[0].transcript
      }
      setInput(prev => {
        const base = prev.replace(/\s*\[…\]$/, '')  // strip previous interim marker
        const appendFinal = finalTranscript ? finalTranscript : ''
        return (base + appendFinal + (interim ? ` ${interim}` : '')).trimStart()
      })
      finalTranscript = ''
    }
    rec.onerror = () => { setIsListening(false); recognitionRef.current = null }
    rec.onend   = () => { setIsListening(false); recognitionRef.current = null }

    rec.start()
    setIsListening(true)
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  // ── Image reading (shared by drag-drop + paste + file picker) ────────────
  const readImageFiles = useCallback((files: File[]) => {
    const remaining = MAX_IMAGES - attachedImages.length
    if (remaining <= 0) { setFileError(`Maximum ${MAX_IMAGES} images allowed`); return }
    const toRead = files.slice(0, remaining)
    if (files.length > remaining) setFileError(`Only ${remaining} more image(s) can be added`)

    toRead.forEach((file) => {
      if (!IMAGE_MIME_TYPES.includes(file.type as ImageMimeType)) {
        setFileError(`"${file.name}" is not a supported image type (PNG, JPG, GIF, WebP)`); return
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setFileError(`"${file.name}" is too large (max 5 MB)`); return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl  = e.target?.result as string
        // dataUrl format: "data:<mimeType>;base64,<data>"
        const base64   = dataUrl.split(',')[1]
        const mimeType = file.type as ImageMimeType
        setAttachedImages(prev => {
          if (prev.some(img => img.name === file.name && img.size === file.size)) return prev
          return [...prev, {
            id:         `img-${Date.now()}-${Math.random()}`,
            name:       file.name || `image.${mimeType.split('/')[1]}`,
            mimeType,
            data:       base64,
            previewUrl: dataUrl,
            size:       file.size
          }]
        })
      }
      reader.onerror = () => setFileError(`Failed to read image "${file.name}"`)
      reader.readAsDataURL(file)
    })
  }, [attachedImages.length])

  // ── Paste images from clipboard ───────────────────────────────────────────
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const imageItems = items.filter(item => item.type.startsWith('image/'))
      if (imageItems.length === 0) return
      // Prevent pasting the image as text
      e.preventDefault()
      const imageFiles = imageItems
        .map(item => item.getAsFile())
        .filter((f): f is File => f !== null)
        .map((f, i) => {
          // Clipboard images often have no name — give them one
          if (!f.name || f.name === 'image.png') {
            const ext = f.type.split('/')[1] ?? 'png'
            return new File([f], `paste-${Date.now()}-${i}.${ext}`, { type: f.type })
          }
          return f
        })
      if (imageFiles.length > 0) readImageFiles(imageFiles)
    }
    textarea.addEventListener('paste', handlePaste)
    return () => textarea.removeEventListener('paste', handlePaste)
  }, [readImageFiles])

  // ── Token / cost stats ───────────────────────────────────────────────────
  const allFileContent = [
    ...attachedFiles.map(f => f.content),
    ...mentionChips.map(m => m.content)
  ].join('')
  // Images are roughly 1000 tokens each (conservative estimate)
  const inputTokens = estimateTokens(input + allFileContent) + attachedImages.length * 1000

  const sessionInputTokens  = messages
    .filter(m => m.role === 'user')
    .reduce((s, m) => s + estimateTokens(m.content), 0)
  const sessionOutputTokens = messages
    .filter(m => m.role === 'assistant')
    .reduce((s, m) => s + estimateTokens(m.content), 0)
  const sessionTotalTokens  = sessionInputTokens + sessionOutputTokens
  const sessionCost         = estimateCost(sessionInputTokens, sessionOutputTokens, effectiveSettings.model)
  const showCost            = hasKnownPricing(effectiveSettings.model) && sessionCost > 0

  // Context-window usage: messages + system prompt (the main cost driver)
  const systemTokens        = estimateTokens(effectiveSettings.systemPrompt)
  const contextUsed         = sessionTotalTokens + systemTokens
  const contextWarn         = getContextWarning(contextUsed, effectiveSettings.model)

  // ── File reading (browse / drag-drop) ────────────────────────────────────
  const readFiles = useCallback((fileList: FileList | File[]) => {
    const files     = Array.from(fileList)
    const remaining = MAX_FILES - attachedFiles.length
    if (remaining <= 0) { setFileError(`Maximum ${MAX_FILES} files allowed`); return }
    const toRead = files.slice(0, remaining)
    if (files.length > remaining) setFileError(`Only ${remaining} more file(s) can be added`)

    toRead.forEach((file) => {
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`"${file.name}" is too large (max ${formatBytes(MAX_FILE_SIZE)})`); return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setAttachedFiles((prev) => {
          if (prev.some(f => f.name === file.name)) return prev
          return [...prev, { id: `${Date.now()}-${Math.random()}`, name: file.name, content, size: file.size, language: getLang(file.name) }]
        })
      }
      reader.onerror = () => setFileError(`Failed to read "${file.name}"`)
      reader.readAsText(file)
    })
  }, [attachedFiles.length])

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCounter.current++; setIsDragging(true) }
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false) }
  const onDragOver  = (e: DragEvent) => { e.preventDefault() }
  const onDrop      = (e: DragEvent) => {
    e.preventDefault(); setIsDragging(false); dragCounter.current = 0
    if (e.dataTransfer.files.length === 0) return
    const files      = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter(isImageFile)
    const textFiles  = files.filter(f => !isImageFile(f))
    if (imageFiles.length > 0) readImageFiles(imageFiles)
    if (textFiles.length  > 0) readFiles(textFiles as unknown as FileList)
  }

  // ── @-mention: textarea onChange ─────────────────────────────────────────
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val    = e.target.value
    const cursor = e.target.selectionStart ?? val.length

    setInput(val)

    // Look for the last '@' before the cursor (not preceded by a word char — ensures
    // we only activate on a freshly typed '@', not mid-word)
    const textBefore = val.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')

    if (atIdx >= 0) {
      // Only activate if the char before '@' is a word boundary (space, newline, or start)
      const charBefore = atIdx > 0 ? textBefore[atIdx - 1] : ' '
      const isBoundary = /[\s,.([\[{]/.test(charBefore) || atIdx === 0

      if (isBoundary) {
        const query = textBefore.slice(atIdx + 1)
        // Still valid if no whitespace or newline after '@' in the query
        if (!query.includes(' ') && !query.includes('\n')) {
          setMentionQuery(query)
          setMentionAnchor(atIdx)
          // Lazy-load file list on first @
          if (mentionFiles.length === 0 && isElectron && settings.workspacePath) {
            loadMentionFiles()
          }
          return
        }
      }
    }

    // No active mention
    setMentionQuery(null)
  }, [mentionFiles.length, settings.workspacePath, loadMentionFiles])

  // ── @-mention: file selected ─────────────────────────────────────────────
  const handleMentionSelect = useCallback(async (filePath: string) => {
    if (!isElectron) return

    // Don't add duplicates
    if (mentionChips.some(m => m.path === filePath)) {
      // Still clean up the @query in input
      setInput(prev => prev.slice(0, mentionAnchor) + prev.slice(mentionAnchor + 1 + (mentionQuery?.length ?? 0)))
      setMentionQuery(null)
      textareaRef.current?.focus()
      return
    }

    try {
      const result = await window.api.readWorkspaceFile(settings.workspacePath, filePath)
      if (result.error) { setFileError(`Cannot read @${filePath}: ${result.error}`); return }

      const name: string = filePath.split('/').pop() ?? filePath
      const mention: MentionFile = {
        id:       `mention-${Date.now()}-${Math.random()}`,
        path:     filePath,
        name,
        content:  result.content,
        language: getLang(name)
      }
      setMentionChips(prev => [...prev, mention])
    } catch {
      setFileError(`Failed to read @${filePath}`)
    }

    // Remove @query text from textarea (replace "@query" with nothing)
    setInput(prev => prev.slice(0, mentionAnchor) + prev.slice(mentionAnchor + 1 + (mentionQuery?.length ?? 0)))
    setMentionQuery(null)
    // Restore focus to textarea
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [mentionChips, mentionAnchor, mentionQuery, settings.workspacePath])

  // ── Ask AI to generate project summary ───────────────────────────────────
  const handleRequestSummaryGenerate = useCallback(() => {
    setInput(
      'Please explore this project and generate a comprehensive project summary. ' +
      'Use list_directory and read key files to understand the stack, architecture, ' +
      'and conventions, then call update_project_summary with a complete PROJECT.md.'
    )
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    // ── /image command detection ──────────────────────────────────────────
    const imageMatch = input.trim().match(/^\/(image|img|imagine)\s+(.+)$/i)
      ?? input.trim().match(/^@image[:\s]+(.+)$/i)
    if (imageMatch && isElectron && !isStreaming) {
      const prompt = imageMatch[2] ?? imageMatch[1]
      setInput('')
      try { localStorage.removeItem(`draft-${conversation?.id ?? 'new'}`) } catch { /* ignore */ }
      // Show generating indicator as a user message
      const genMsg = `/image ${prompt}`
      await sendMessage(genMsg)
      // Trigger image generation and post result
      const result = await window.api.generateImage(prompt, effectiveSettings)
      if (result.ok && result.b64) {
        // Attach as an image in a follow-up user message that the AI responds to
        const imgAttachment = [{ mimeType: 'image/png' as const, data: result.b64 }]
        await sendMessage(`Generated image for: "${prompt}"`, imgAttachment)
      } else {
        await sendMessage(`Image generation failed: ${result.error ?? 'unknown error'}`)
      }
      return
    }

    const hasText     = input.trim().length > 0
    const hasFiles    = attachedFiles.length > 0
    const hasMentions = mentionChips.length > 0
    const hasImages   = attachedImages.length > 0
    if ((!hasText && !hasFiles && !hasMentions && !hasImages) || isStreaming) return

    // Build text content: mention files + attached files become markdown code blocks
    const mentionBlocks = mentionChips.map(m =>
      `**@${m.path}**\n\`\`\`${m.language}\n${m.content}\n\`\`\``
    )
    const attachBlocks = attachedFiles.map(f =>
      `**📎 ${f.name}**\n\`\`\`${f.language}\n${f.content}\n\`\`\``
    )
    const allBlocks = [...mentionBlocks, ...attachBlocks]

    let fullMessage = ''
    if (allBlocks.length > 0) {
      fullMessage = allBlocks.join('\n\n')
      if (hasText) fullMessage += `\n\n${input.trim()}`
    } else {
      fullMessage = input.trim()
    }

    // Build image attachments (strip preview-only fields)
    const images: ImageAttachment[] = attachedImages.map(({ mimeType, data }) => ({ mimeType, data }))

    setInput('')
    try { localStorage.removeItem(`draft-${conversation?.id ?? 'new'}`) } catch { /* ignore */ }
    setAttachedFiles([])
    setMentionChips([])
    setAttachedImages([])
    setUrlBannerDismissed(false)
    await sendMessage(fullMessage, images.length > 0 ? images : undefined)
  }

  // ── Branch conversation at a message ─────────────────────────────────────
  const handleBranch = useCallback(async (messageId: string) => {
    const idx = messages.findIndex(m => m.id === messageId)
    if (idx < 0) return

    const branchedMessages = messages.slice(0, idx + 1)
    const newConvId = Date.now().toString(36) + Math.random().toString(36).slice(2)

    // Derive a title: prefix with ⎇ to indicate a branch
    const firstUser = branchedMessages.find(m => m.role === 'user')
    const baseTitle = firstUser?.content.trim().slice(0, 42) || 'Chat'
    const title = `⎇ ${baseTitle}${baseTitle.length >= 42 ? '…' : ''}`

    const branchedConv: Conversation = {
      id:        newConvId,
      title,
      messages:  branchedMessages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider:  effectiveSettings.provider,
      model:     effectiveSettings.model
    }

    if (isElectron) await window.api.saveConversation(branchedConv)
    // onConversationUpdate also tells App to switch to this conversation
    onConversationUpdate(branchedConv)
  }, [messages, effectiveSettings, onConversationUpdate])

  // ── Keyboard in textarea ──────────────────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // When mention dropdown is open, let FileMentionDropdown handle nav keys
    // (its capture-phase listener fires before this and calls e.stopPropagation)
    if (mentionQuery !== null && ['ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(e.key)) {
      e.preventDefault()
      return
    }
    if (mentionQuery !== null && e.key === 'Enter') {
      e.preventDefault()
      return  // handled by dropdown's capture listener
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const noApiKey = settings.provider === 'gemini' ? !settings.vertexProjectId : !settings.apiKey
  const canSend  = (input.trim().length > 0 || attachedFiles.length > 0 || mentionChips.length > 0 || attachedImages.length > 0) && !noApiKey

  // ── Quick action chips ────────────────────────────────────────────────────
  // Context-sensitive chips shown when there are messages and the input is empty
  interface QuickAction { label: string; icon: string; prompt: string }

  const quickActions: QuickAction[] = messages.length === 0 ? [] : (() => {
    const lastAI = [...messages].reverse().find(m => m.role === 'assistant')
    const hasCode    = lastAI?.content.includes('```') ?? false
    const hasWorkspace = !!settings.workspacePath

    const actions: QuickAction[] = []

    if (hasCode) {
      actions.push({ label: 'Add tests',   icon: '🧪', prompt: 'Write unit tests for the code you just wrote.' })
      actions.push({ label: 'Explain',     icon: '💡', prompt: 'Explain the code you just wrote in simple terms.' })
    }
    if (hasWorkspace) {
      actions.push({ label: 'Fix errors',  icon: '🔧', prompt: 'Check for any errors or issues in the current code and fix them.' })
      actions.push({ label: 'Improve',     icon: '✨', prompt: 'Suggest and apply improvements to the code — focus on readability, performance, and best practices.' })
    }
    if (!hasCode) {
      actions.push({ label: 'Summarize',   icon: '📋', prompt: 'Summarize what we have discussed so far in a few bullet points.' })
      actions.push({ label: 'Elaborate',   icon: '🔍', prompt: 'Elaborate on the last response with more detail and examples.' })
    }
    actions.push(  { label: 'Continue',    icon: '▶️', prompt: 'Continue.' })

    return actions.slice(0, 5)
  })()

  const convTitle      = conversation?.title ?? 'New Chat'
  const totalChipCount = attachedFiles.length + mentionChips.length + attachedImages.length

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Mode tab bar */}
      <ModeTabBar mode={mode} onChange={handleModeChange} disabled={isStreaming} />

      {/* Header / drag region */}
      <div
        className="h-9 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left side — .chatui badge only (model moved to bottom bar) */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {projectConfig && (
            <span
              title={[
                projectConfig.model         ? `Model: ${projectConfig.model}`              : null,
                projectConfig.disabledTools?.length ? `Disabled: ${projectConfig.disabledTools.join(', ')}` : null,
                projectConfig.rules?.length ? `${projectConfig.rules.length} rule(s)`      : null,
              ].filter(Boolean).join('\n') || '.chatui config active'}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono
                         bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400
                         border border-emerald-200 dark:border-emerald-700 cursor-default select-none"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              .chatui
            </span>
          )}
        </div>

        {/* Right-side header actions (marked no-drag) */}
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Token / cost pill */}
          {sessionTotalTokens > 0 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-600 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
              ~{formatTokens(sessionTotalTokens)} tokens
              {showCost && <> · {formatCost(sessionCost)}</>}
            </span>
          )}
          {/* Template picker */}
          {onSettingsUpdate && (
            <QuickTemplateMenu
              currentPrompt={settings.systemPrompt}
              onApply={(prompt) => {
                const next = { ...settings, systemPrompt: prompt }
                onSettingsUpdate(next)
              }}
            />
          )}
          {/* Project Summary */}
          {settings.workspacePath && (
            <button
              onClick={() => setSummaryOpen(true)}
              title="Project Summary — export to Claude, Cursor, ChatGPT…"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            >
              <span className="text-base leading-none">📄</span>
            </button>
          )}
          {/* Pinned files */}
          {settings.workspacePath && (
            <button
              onClick={() => setPinsOpen(true)}
              title="Pinned Context Files — always in AI system prompt"
              className="relative w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors"
            >
              <span className="text-base leading-none">📌</span>
              {pinsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-orange-500 text-white text-[8px] font-bold flex items-center justify-center leading-none">
                  {pinsCount}
                </span>
              )}
            </button>
          )}
          {/* Memory */}
          {settings.workspacePath && (
            <button
              onClick={() => setMemoryOpen(true)}
              title="Project Memory"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors"
            >
              <span className="text-base leading-none">🧠</span>
            </button>
          )}
          {/* Task Queue */}
          <button
            onClick={() => setQueueOpen(v => !v)}
            title="Task Queue — run multiple prompts sequentially"
            className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
              queueOpen
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
            }`}
          >
            <span className="text-base leading-none">📋</span>
          </button>
          {/* Custom plugins badge */}
          {pluginsCount > 0 && (
            <span
              title={`${pluginsCount} custom tool plugin${pluginsCount !== 1 ? 's' : ''} loaded from .ai-context/tools/`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono
                         bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400
                         border border-violet-200 dark:border-violet-700 cursor-default select-none"
            >
              🔌 {pluginsCount}
            </span>
          )}
          {/* RAG indicator */}
          {ragChunks > 0 && (
            <span
              title={`RAG: ${ragChunks} relevant code chunk${ragChunks !== 1 ? 's' : ''} auto-injected into context`}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono
                         bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400
                         border border-teal-200 dark:border-teal-700"
            >
              🔍 RAG {ragChunks}
            </span>
          )}
          {/* Export */}
          <ExportMenu
            title={convTitle}
            messages={messages}
            disabled={messages.length === 0}
          />
        </div>
      </div>

      {/* Messages + Agent progress sidebar */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div
          className="flex-1 overflow-y-auto px-4 py-6"
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          aria-atomic="false"
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 select-none">
              <div className="text-4xl mb-3">{mode === 'agent' ? '⚡' : '✦'}</div>
              <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
                {mode === 'agent' ? 'Give the agent a goal' : 'How can I help you?'}
              </p>
              <p className="text-sm mt-1">
                {noApiKey
                  ? <span className="text-yellow-500">⚠ Configure your API key in Settings first</span>
                  : mode === 'agent'
                    ? <span className="text-gray-400 dark:text-gray-600">Describe what you want built — the agent will plan and execute autonomously</span>
                    : <span className="text-gray-400 dark:text-gray-600">Type a message, paste/drop images, or type @ to mention a file</span>
                }
              </p>
            </div>
          ) : (
            <MessageList
              messages={messages}
              settings={settings}
              isStreaming={isStreaming}
              messagesEndRef={messagesEndRef}
              editMessage={editMessage}
              handleBranch={handleBranch}
              rateMessage={rateMessage}
              setEditorFile={setEditorFile}
            />
          )}
        </div>

        {/* Mode-specific sidebars */}
        {mode === 'agent' && messages.length > 0 && (
          <AgentProgressPanel
            messages={messages}
            isStreaming={isStreaming}
            autoContinueCount={autoContinueCount}
            maxContinues={maxAutoContiues}
            agentPaused={agentPaused}
            onPause={pauseAgent}
            onResume={resumeAgent}
            onStop={abortStream}
          />
        )}
        {mode === 'review' && (
          <ReviewPanel
            workspacePath={settings.workspacePath}
            onReviewStart={(prompt) => sendMessage(prompt)}
            isStreaming={isStreaming}
          />
        )}
        {mode === 'pair' && (
          <PairModePanel
            workspacePath={settings.workspacePath}
            isStreaming={isStreaming}
            onSuggest={(prompt) => sendMessage(prompt)}
          />
        )}

        {/* Activity panel — available in Code mode (collapsed strip by default) */}
        {mode === 'code' && (
          <ActivityPanel
            settings={effectiveSettings}
            messages={messages}
            isStreaming={isStreaming}
            isOpen={activityOpen}
            onToggle={() => setActivityOpen(v => !v)}
          />
        )}
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none
                        bg-blue-500/10 border-2 border-dashed border-blue-400 dark:border-blue-500 m-2 rounded-xl">
          <svg className="w-12 h-12 text-blue-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-blue-500 dark:text-blue-400 font-semibold text-lg">Drop files to attach</p>
          <p className="text-blue-400 text-sm mt-1">Supports code, config, and text files</p>
        </div>
      )}

      {/* Context-limit warning banner */}
      {contextWarn && (
        <div className={`flex items-center gap-2.5 px-4 py-2 text-xs border-t flex-shrink-0 ${
          contextWarn.level === 'critical'
            ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
            : contextWarn.level === 'warning'
              ? 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400'
              : 'bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-500'
        }`}>
          {/* Icon */}
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>

          {/* Message */}
          <span className="flex-1">
            {contextWarn.level === 'critical'
              ? <>Context {Math.round(contextWarn.pct * 100)}% full — responses may be cut off. <strong>Start a new chat or branch</strong> to continue safely.</>
              : contextWarn.level === 'warning'
                ? <>Context {Math.round(contextWarn.pct * 100)}% full ({formatTokens(contextUsed)} / {formatTokens(contextWarn.limit)}). Getting close — consider branching soon.</>
                : <>Context {Math.round(contextWarn.pct * 100)}% full ({formatTokens(contextUsed)} / {formatTokens(contextWarn.limit)}).</>
            }
          </span>

          {/* Quick action: new chat */}
          {contextWarn.level !== 'caution' && (
            <button
              onClick={() => {
                // Fire a new-chat action by clearing to a fresh conversation
                window.dispatchEvent(new CustomEvent('new-chat-shortcut'))
              }}
              className={`flex-shrink-0 px-2 py-0.5 rounded font-medium transition-colors ${
                contextWarn.level === 'critical'
                  ? 'bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800 text-red-700 dark:text-red-300'
                  : 'bg-orange-100 dark:bg-orange-900/50 hover:bg-orange-200 dark:hover:bg-orange-800 text-orange-700 dark:text-orange-300'
              }`}
            >
              New chat
            </button>
          )}
        </div>
      )}

      {/* Context compression indicator */}
      {isCompressing && (
        <div className="flex justify-center pb-1 flex-shrink-0">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 text-[11px] text-purple-600 dark:text-purple-400">
            <svg className="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Compressing context…
          </span>
        </div>
      )}

      {/* Floating stop button — shown prominently while streaming */}
      {isStreaming && (
        <div className="flex justify-center pb-2 flex-shrink-0">
          <button
            onClick={abortStream}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 shadow-md hover:shadow-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 transition-all"
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-current flex-shrink-0" />
            Stop generating
          </button>
        </div>
      )}

      {/* Context token usage */}
      <ContextTokenBar settings={effectiveSettings} messages={messages} />

      {/* Voice mode: show recorder instead of text input */}
      {mode === 'voice' && (
        <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
          <VoiceRecorder
            onTranscript={(text) => sendMessage(text)}
            isStreaming={isStreaming}
            settings={settings}
            lastAIMessage={
              [...messages].reverse().find(m => m.role === 'assistant' && !m.isStreaming)?.content
            }
          />
        </div>
      )}

      {/* Input area */}
      {mode !== 'voice' && (
      <div className="border-t border-gray-200 dark:border-gray-800 p-4 flex-shrink-0 bg-white dark:bg-gray-950 relative">

        {/* @-mention dropdown — rendered above input area */}
        {mentionQuery !== null && settings.workspacePath && (
          <FileMentionDropdown
            query={mentionQuery}
            files={mentionFiles}
            onSelect={handleMentionSelect}
            onClose={() => setMentionQuery(null)}
          />
        )}

        {/* File error */}
        {fileError && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {fileError}
          </div>
        )}

        {/* URL detection banner */}
        {detectedUrls.length > 0 && !urlBannerDismissed && (
          <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-xs text-blue-700 dark:text-blue-300">
            <span className="text-base leading-none flex-shrink-0">🔗</span>
            <div className="flex-1 min-w-0">
              <span className="font-medium">URL detected</span>
              <span className="text-blue-600 dark:text-blue-400"> — the AI will automatically fetch its content when you send.</span>
              {detectedUrls.length > 1 && (
                <span className="text-blue-500 dark:text-blue-400"> ({detectedUrls.length} URLs)</span>
              )}
            </div>
            <button
              onClick={() => setUrlBannerDismissed(true)}
              className="flex-shrink-0 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Quick action chips — shown when input is empty and we have messages */}
        {quickActions.length > 0 && input.trim() === '' && totalChipCount === 0 && !isStreaming && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => {
                  setInput(action.prompt)
                  setTimeout(() => textareaRef.current?.focus(), 0)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                           bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400
                           border border-gray-200 dark:border-gray-700
                           hover:bg-blue-50 dark:hover:bg-blue-900/30
                           hover:text-blue-600 dark:hover:text-blue-400
                           hover:border-blue-300 dark:hover:border-blue-700
                           transition-colors"
              >
                <span className="text-sm leading-none">{action.icon}</span>
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Chips: images + @-mentions + attached files */}
        {totalChipCount > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachedImages.map(img => (
              <ImageChip key={img.id} image={img} onRemove={() => setAttachedImages(prev => prev.filter(x => x.id !== img.id))} />
            ))}
            {mentionChips.map(m => (
              <MentionChip key={m.id} file={m} onRemove={() => setMentionChips(prev => prev.filter(x => x.id !== m.id))} />
            ))}
            {attachedFiles.map(f => (
              <FileChip key={f.id} file={f} onRemove={() => setAttachedFiles(prev => prev.filter(x => x.id !== f.id))} />
            ))}
          </div>
        )}

        {/* Input box */}
        <div className="flex items-end gap-2 bg-gray-100 dark:bg-gray-800 rounded-2xl px-3 py-2 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
          {/* Voice input button */}
          <button
            onClick={isListening ? stopListening : startListening}
            title={isListening ? 'Stop listening' : 'Voice input (speech to text)'}
            aria-label={isListening ? 'Stop listening' : 'Voice input (speech to text)'}
            className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
              isListening
                ? 'text-red-500 bg-red-50 dark:bg-red-900/30 animate-pulse'
                : 'text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
            }`}
          >
            <svg className="w-4 h-4" fill={isListening ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </button>

          {/* Prompt Library button */}
          <button
            onClick={() => setPromptLibOpen(true)}
            title="Prompt Library (saved prompts with variables)"
            aria-label="Prompt Library (saved prompts with variables)"
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors
                       text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/30"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={noApiKey || attachedFiles.length >= MAX_FILES}
            title="Attach files (or drag & drop)"
            aria-label="Attach files (or drag & drop)"
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors
                       text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_EXTENSIONS} className="hidden"
            onChange={(e) => { if (e.target.files) { readFiles(e.target.files); e.target.value = '' } }} />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              noApiKey               ? 'Configure your API key in Settings first…' :
              totalChipCount > 0     ? 'Add a message… (optional)  ·  Paste more images or type @' :
              settings.workspacePath ? 'Message AI…  ·  Paste or drag images  ·  Type @ to mention a file  ·  Enter ↵ to send' :
              'Message AI…  ·  Paste or drag images  ·  Enter ↵ to send, Shift+Enter for newline'
            }
            disabled={noApiKey}
            rows={1}
            aria-label="Message input"
            className="flex-1 bg-transparent resize-none outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 disabled:opacity-50 py-1"
          />

          {/* Send / Stop */}
          {isStreaming ? (
            <button onClick={abortStream}
              className="flex-shrink-0 w-7 h-7 rounded-lg bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center text-white text-xs"
              title="Stop generating"
              aria-label="Stop generation">■</button>
          ) : (
            <button onClick={handleSend} disabled={!canSend}
              className="flex-shrink-0 w-7 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-white"
              title="Send (Enter)"
              aria-label="Send message">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between mt-2 px-1">

          {/* Left: approve-edits toggle (only when workspace is set) */}
          <div className="flex items-center gap-1">
            {onSettingsUpdate && settings.workspacePath ? (
              <button
                onClick={() => onSettingsUpdate({ ...settings, requireEditApproval: settings.requireEditApproval === false ? true : false })}
                title={settings.requireEditApproval !== false
                  ? 'Edit approval ON — AI will show a diff and ask before writing files. Click to disable.'
                  : 'Edit approval OFF — AI writes files without asking. Click to enable.'}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all border
                  ${settings.requireEditApproval !== false
                    ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                    : 'text-gray-400 dark:text-gray-600 bg-transparent border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                  }`}
              >
                {/* shield icon */}
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <span>{settings.requireEditApproval !== false ? 'Approve edits' : 'Auto-write'}</span>
              </button>
            ) : <div />}
          </div>

          {/* Right: model picker + reasoning depth + token hint */}
          <div className="flex items-center gap-1">
            {/* Token / attach hint */}
            <p className="text-xs text-gray-400 dark:text-gray-600 mr-1">
              {input.length > 0 || attachedImages.length > 0
                ? `~${formatTokens(inputTokens)} tokens`
                : totalChipCount > 0
                  ? `${totalChipCount} attached`
                  : null
              }
            </p>
            {totalChipCount > 0 && (
              <button
                onClick={() => { setAttachedFiles([]); setMentionChips([]); setAttachedImages([]) }}
                className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors mr-1"
              >
                Clear
              </button>
            )}

            {/* Reasoning depth — only shown for supported models */}
            {onSettingsUpdate && (
              <ReasoningDepthPicker
                provider={effectiveSettings.provider}
                model={effectiveSettings.model}
                depth={(effectiveSettings.reasoningDepth ?? 'off') as 'off' | 'low' | 'medium' | 'high'}
                onChange={(d) => onSettingsUpdate({ ...settings, reasoningDepth: d })}
              />
            )}

            {/* Model picker pill — opens upward */}
            {onSettingsUpdate ? (
              <ModelPicker
                settings={effectiveSettings}
                openUp
                onApply={(model, provider) => {
                  onSettingsUpdate({ ...settings, model, provider })
                  if (conversation && isElectron) {
                    const updated = { ...conversation, model, provider }
                    window.api.saveConversation(updated)
                    onConversationUpdate(updated)
                  }
                }}
              />
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-600 px-1 truncate max-w-[180px]">
                {effectiveSettings.model}
              </span>
            )}

            {/* Context usage circle — right of model picker */}
            <ContextCircle settings={effectiveSettings} messages={messages} />
          </div>
        </div>
      </div>
      )}

      {/* Project Summary modal */}
      {summaryOpen && settings.workspacePath && (
        <ProjectSummaryPanel
          workspacePath={settings.workspacePath}
          onClose={() => setSummaryOpen(false)}
          onRequestGenerate={handleRequestSummaryGenerate}
        />
      )}

      {/* Project Memory modal */}
      {memoryOpen && settings.workspacePath && (
        <MemoryPanel
          workspacePath={settings.workspacePath}
          onClose={() => setMemoryOpen(false)}
        />
      )}

      {/* Prompt Library modal */}
      {promptLibOpen && (
        <PromptLibrary
          onUse={(content) => {
            setInput(content)
            setTimeout(() => textareaRef.current?.focus(), 50)
          }}
          onClose={() => setPromptLibOpen(false)}
        />
      )}

      {/* Pinned context files modal */}
      {pinsOpen && settings.workspacePath && (
        <PinnedFilesPanel
          workspacePath={settings.workspacePath}
          onClose={() => {
            setPinsOpen(false)
            // Refresh count after edits
            if (isElectron)
              window.api.readPins(settings.workspacePath).then(({ pins }) => setPinsCount(pins.length))
          }}
        />
      )}

      {/* Inline file editor modal */}
      {editorFile && settings.workspacePath && (
        <FileEditorModal
          workspacePath={settings.workspacePath}
          relativePath={editorFile}
          onClose={() => setEditorFile(null)}
        />
      )}

      {/* Task queue panel */}
      {queueOpen && (
        <TaskQueuePanel
          isStreaming={isStreaming}
          onSend={(prompt) => {
            setInput(prompt)
            // Use a tiny delay so input state is set before handleSend reads it
            setTimeout(async () => {
              await sendMessage(prompt)
            }, 0)
          }}
          onClose={() => setQueueOpen(false)}
        />
      )}
    </div>
  )
})

export default ChatWindow
