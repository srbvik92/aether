import {
  useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo,
  forwardRef, useImperativeHandle,
  KeyboardEvent, DragEvent
} from 'react'
import React from 'react'
import ReactDOM from 'react-dom'
import { AppSettings, Conversation, ChatMessage, ConversationMode, ImageAttachment, ImageMimeType, PROVIDER_MODELS, PROVIDER_BASE_URLS, Provider, ProjectConfig, supportsReasoningDepth } from '../../../shared/types'
import { PROMPT_TEMPLATES, findMatchingTemplate } from '../utils/promptTemplates'
import MessageBubble, { toolIcon, toolLabel } from './MessageBubble'
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
import AgentView from './AgentView'
import DiagnosticsPanel from './DiagnosticsPanel'
import ActivityPanel from './ActivityPanel'
import VoiceRecorder from './VoiceRecorder'
import ReviewPanel from './ReviewPanel'
import PairModePanel from './PairModePanel'
import DatabaseBrowserPanel from './DatabaseBrowserPanel'
import TestRunnerPanel from './TestRunnerPanel'
import SessionReplayPanel from './SessionReplayPanel'
import ParallelAgentPanel from './ParallelAgentPanel'
import LivePreviewPanel from './LivePreviewPanel'
import SlashCommandMenu, { filterSlashCommands, SlashCommand } from './SlashCommandMenu'
import { useChat } from '../hooks/useChat'
import { estimateTokens, estimateCost, formatTokens, formatCost, hasKnownPricing, getContextWarning } from '../utils/tokenCost'

const isElectron = typeof window !== 'undefined' && !!window.api

// ── Public handle (for parent to call focusInput / inject text via ref) ──────
export interface ChatWindowHandle {
  focusInput: () => void
  /** Prepend text into the chat input (used by editor "Ask AI" button) */
  setInputText: (text: string) => void
  /** Scroll to and briefly highlight a specific message by id */
  scrollToMessage: (msgId: string) => void
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
  onOpenSettings?:       () => void
  /** Pre-set workspace for a brand-new chat (used by "New chat in folder X" in sidebar) */
  initialWorkspacePath?: string
  /** Called once ChatWindow has consumed initialWorkspacePath so parent can clear it */
  onWorkspacePathConsumed?: () => void
  /** Pre-set agent task prompt — auto-sends in Agent mode once the component mounts */
  initialAgentTask?: string
  /** Called once ChatWindow has consumed initialAgentTask so parent can clear it */
  onAgentTaskConsumed?: () => void
  /** Opens the Monaco code editor panel alongside the chat */
  onOpenEditor?: () => void
  /** Called whenever the per-conversation workspace folder changes */
  onWorkspaceChange?: (path: string | undefined) => void
  /** Navigate directly to a different conversation by id (used by branch → parent) */
  onNavigateTo?: (id: string) => void
  /** Message id to scroll to on mount (from global search) */
  initialScrollToMsgId?: string
  /** Called once ChatWindow has consumed initialScrollToMsgId */
  onScrollToMsgConsumed?: () => void
  /** Auto-update state forwarded from App — rendered as a tiny chip in the title bar */
  updateStatus?:     import('../../../shared/types').UpdateStatusPayload | null
  onUpdateDownload?: () => void
  onUpdateInstall?:  () => void
  onUpdateDismiss?:  () => void
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

// ── Image chip (thumbnail card — pasted / dragged image) ─────────────────────
function ImageChip({ image, onRemove }: { image: AttachedImage; onRemove: () => void }) {
  return (
    <div className="relative group/img flex-shrink-0" title={`${image.name} · ${formatBytes(image.size)}`}>
      <img
        src={image.previewUrl}
        alt={image.name}
        className="w-14 h-14 rounded-xl object-cover border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
      />
      {/* Remove button — appears on hover */}
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-800 dark:bg-gray-600 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity shadow"
        title="Remove image"
      >
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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
  anthropic:  '◆',
  openai:     '⬡',
  gemini:     '✦',
  nvidia:     '⬥',
  openrouter: '⇄',
  custom:     '⚙',
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic:  'Anthropic',
  openai:     'OpenAI',
  gemini:     'Google Gemini',
  nvidia:     'NVIDIA NIM',
  openrouter: 'OpenRouter',
  custom:     'Custom / Local',
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
  settings, onApply, openUp = false, compact = false
}: {
  settings: AppSettings
  onApply: (model: string, provider: Provider) => void
  openUp?: boolean
  compact?: boolean
}) {
  const [open, setOpen]         = useState(false)
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const ref        = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const portalRef  = useRef<HTMLDivElement>(null)
  const searchRef  = useRef<HTMLInputElement>(null)

  // OpenRouter dynamic model list
  const [orModels, setOrModels]   = useState<Array<{ id: string; name: string; isFree: boolean; contextLength: number }>>([])
  const [orLoading, setOrLoading] = useState(false)
  const orFetchedRef              = useRef(false)   // ref avoids stale-closure issues

  const fetchOrModels = useCallback(async (apiKey?: string) => {
    if (orFetchedRef.current || !isElectron) return
    orFetchedRef.current = true   // mark immediately to prevent double-fetch
    setOrLoading(true)
    try {
      const result = await window.api.getOpenRouterModels(apiKey)
      if (result.ok && result.models.length > 0) {
        setOrModels(result.models)
      } else {
        orFetchedRef.current = false  // allow retry if it failed
      }
    } catch {
      orFetchedRef.current = false    // allow retry on error
    } finally {
      setOrLoading(false)
    }
  }, [])

  // Build the full provider+model catalogue
  const builtInProviders: Provider[] = ['anthropic', 'openai', 'gemini', 'nvidia']
  const customProviders = settings.customProviders ?? []

  // Expand the active provider by default when opening
  useEffect(() => {
    if (!open) { setSearch(''); setDropdownPos(null); return }
    setExpanded({ [settings.provider]: true })
    // Kick off OpenRouter model fetch the first time the dropdown is opened
    fetchOrModels(settings.provider === 'openrouter' ? settings.apiKey : undefined)
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
        title={compact ? `${shortName || settings.model} (${PROVIDER_LABELS[settings.provider] ?? settings.provider}) — click to switch` : 'Switch model or provider'}
        className={`flex items-center gap-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all group ${compact ? 'w-7 h-7 justify-center' : 'px-2.5 py-1.5'}`}
      >
        <span className="text-gray-400 dark:text-gray-500 group-hover:text-blue-500 transition-colors">{icon}</span>
        {!compact && <span className="max-w-[160px] truncate">{shortName || settings.model}</span>}
        {!compact && <span className="text-gray-300 dark:text-gray-600 text-[10px]">{PROVIDER_LABELS[settings.provider] ?? settings.provider}</span>}
        {!compact && (
          <svg className={`w-2.5 h-2.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
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

            {/* ── OpenRouter ── */}
            {(() => {
              const visibleOr = orModels.filter(m =>
                !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
              )
              if (q && visibleOr.length === 0 && !orLoading) return null
              const isOpen = isSearching || expanded['openrouter']
              return (
                <div className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <SectionHeader
                    provider="openrouter"
                    label="OpenRouter"
                    count={orModels.length}
                  />
                  {isOpen && (
                    <div className="pb-1">
                      {orLoading && (
                        <p className="text-[11px] text-gray-400 pl-7 pb-2 animate-pulse">Loading models…</p>
                      )}
                      {!orLoading && orModels.length === 0 && (
                        <div className="pl-7 pr-3 pb-2">
                          <p className="text-[11px] text-gray-400 mb-1">No models loaded yet.</p>
                          <button
                            onClick={() => fetchOrModels(settings.provider === 'openrouter' ? settings.apiKey : undefined)}
                            className="text-[11px] text-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            Fetch models
                          </button>
                        </div>
                      )}
                      {(q ? visibleOr : orModels).map(m => {
                        const isActive = m.id === settings.model && settings.provider === 'openrouter'
                        return (
                          <button
                            key={m.id}
                            onClick={() => { onApply(m.id, 'openrouter'); setOpen(false) }}
                            className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-left transition-colors
                              hover:bg-gray-50 dark:hover:bg-gray-800/60
                              ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                                  {m.name}
                                </p>
                                {m.isFree && (
                                  <span className="flex-shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700">
                                    FREE
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">{m.id}</p>
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
              )
            })()}

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
  provider, model, depth, onChange, compact
}: {
  provider: string
  model:    string
  depth:    DepthKey
  onChange: (d: DepthKey) => void
  compact?: boolean
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
        className={`flex items-center gap-1 rounded-lg text-xs font-medium border border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all ${cfg.color} ${compact ? 'w-7 h-7 justify-center' : 'px-2 py-1.5'}`}
      >
        <span>{cfg.icon}</span>
        {!compact && <span>{cfg.label}</span>}
        {!compact && (
          <svg className={`w-2.5 h-2.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
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
  currentPrompt, onApply, compact
}: { currentPrompt: string; onApply: (prompt: string) => void; compact?: boolean }) {
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
        className={`flex items-center gap-1 rounded-md text-xs transition-colors ${compact ? 'w-7 h-7 justify-center' : 'px-2 py-1'} ${
          active
            ? 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
            : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
        }`}
        title={compact ? (active?.name ?? 'Template') : 'Switch prompt template'}
      >
        <span className="text-sm leading-none">{active?.icon ?? '⚡'}</span>
        {!compact && <span>{active?.name ?? 'Template'}</span>}
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
  title, messages, conversation, disabled, compact
}: {
  title: string
  messages: { role: string; content: string }[]
  conversation: import('../../../shared/types').Conversation | null
  disabled: boolean
  compact?: boolean
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

  const doExport = async (format: 'md' | 'txt' | 'json') => {
    setOpen(false)
    if (!isElectron || messages.length === 0) return
    const safeName = title.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-') || 'chat'
    let content: string
    if (format === 'json') {
      // Full conversation object — can be re-imported perfectly
      content = JSON.stringify(conversation ?? { title, messages, createdAt: Date.now(), updatedAt: Date.now() }, null, 2)
    } else {
      content = format === 'md' ? buildMarkdown(title, messages) : buildText(title, messages)
    }
    await window.api.exportChat({ defaultName: safeName, content, format })
  }

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className={`flex items-center gap-1 rounded-md text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${compact ? 'w-7 h-7 justify-center' : 'px-2 py-1'}`}
        title="Export conversation"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {!compact && 'Export'}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                        rounded-lg shadow-lg py-1 z-50 text-sm">
          <button
            onClick={() => doExport('json')}
            className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300 flex items-center gap-2"
          >
            <span className="text-base">💾</span> JSON (importable)
          </button>
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
  messages:         ChatMessage[]
  settings:         AppSettings
  isStreaming:      boolean
  messagesEndRef:   React.RefObject<HTMLDivElement>
  editMessage:      (id: string, content: string) => void
  handleBranch:     (messageId: string) => void
  rateMessage:      (id: string, rating: 'up' | 'down') => void
  scrollToMsgId?:   string
  onScrollConsumed?: () => void
  setEditorFile:    (path: string) => void
  onOpenSettings?:  () => void
  activeWorkspace?: string
}

function MessageList({ messages, settings, isStreaming, messagesEndRef, editMessage, handleBranch, rateMessage, setEditorFile, onOpenSettings, activeWorkspace, scrollToMsgId, onScrollConsumed }: MessageListProps) {
  const [visibleStart, setVisibleStart] = useState(() => Math.max(0, messages.length - PAGE_SIZE))

  // Scroll to target message (from global search or audit log jump)
  useEffect(() => {
    if (!scrollToMsgId) return
    // If the target message is in the hidden range, expose it
    const targetIdx = messages.findIndex(m => m.id === scrollToMsgId)
    if (targetIdx >= 0 && targetIdx < visibleStart) {
      setVisibleStart(0)  // show all messages
    }
    // After render, scroll to the element and flash-highlight it
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${scrollToMsgId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.style.transition = 'background-color 0.3s ease'
        el.style.backgroundColor = 'rgba(253, 224, 71, 0.35)'  // yellow flash
        setTimeout(() => { el.style.backgroundColor = ''; onScrollConsumed?.() }, 1800)
      } else {
        onScrollConsumed?.()
      }
    }, 120)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToMsgId])

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
        const isLastAI    = msg.role === 'assistant' && absoluteIdx === messages.length - 1 && !msg.isStreaming

        // Detect mode transitions — show a divider when agent mode toggles
        const prevMsg        = absoluteIdx > 0 ? messages[absoluteIdx - 1] : null
        const prevWasAgent   = !!(prevMsg?.agentMode)
        const thisIsAgent    = !!(msg.agentMode)
        const modeChanged    = prevMsg !== null && prevWasAgent !== thisIsAgent && msg.role === 'assistant'

        return (
          <React.Fragment key={msg.id}>
            <div id={`msg-${msg.id}`} style={{ borderRadius: '0.5rem' }}>
            {modeChanged && (
              <div className="flex items-center gap-2 px-4 py-1 select-none">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />
                <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                  thisIsAgent
                    ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    : 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}>
                  {thisIsAgent
                    ? <><span>⚡</span> Switched to Agent mode</>
                    : <><span>💬</span> Switched to Code mode</>
                  }
                </span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent" />
              </div>
            )}
            <MessageBubble
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
              onOpenFile={activeWorkspace ? (path) => setEditorFile(path) : undefined}
              onOpenSettings={onOpenSettings}
            />
            </div>
          </React.Fragment>
        )
      })}
      <div ref={messagesEndRef} />
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const ChatWindow = forwardRef<ChatWindowHandle, Props>(function ChatWindow(
  { conversation, settings, onConversationUpdate, onSettingsUpdate, onNew, onOpenSearch, onOpenSettings,
    initialWorkspacePath, onWorkspacePathConsumed,
    initialAgentTask, onAgentTaskConsumed, onOpenEditor, onWorkspaceChange, onNavigateTo,
    initialScrollToMsgId, onScrollToMsgConsumed,
    updateStatus, onUpdateDownload, onUpdateInstall, onUpdateDismiss }, ref
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
  const [auditOpen,       setAuditOpen]       = useState(false)
  const [scrollToMsgId,   setScrollToMsgId]   = useState<string | undefined>(initialScrollToMsgId)
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
  // Database browser
  const [dbBrowserOpen,       setDbBrowserOpen]       = useState(false)
  const [showParallelPanel,   setShowParallelPanel]   = useState(false)

  // Auto-open parallel panel when the LLM triggers run_parallel_agents
  useEffect(() => {
    if (!isElectron) return
    window.api.onParallelStart((p) => {
      if (p.conversationId === (conversation?.id ?? 'new')) {
        setShowParallelPanel(true)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id])

  // Live Preview
  const [showPreviewPanel,    setShowPreviewPanel]    = useState(false)
  // Test runner
  const [testRunnerOpen,  setTestRunnerOpen]  = useState(false)
  // Custom plugins
  const [pluginsCount,    setPluginsCount]    = useState(0)
  const [ragChunks,       setRagChunks]       = useState(0)

  // ── Responsive panel tracking ─────────────────────────────────────────────
  // We measure the ACTUAL right-side width each frame so compact triggers the
  // instant the two sides would collide — no magic fixed pixel constants.
  const panelRef    = useRef<HTMLDivElement>(null)
  const hdrRightRef = useRef<HTMLDivElement>(null)   // right toolbar section

  const [panelWidth,    setPanelWidth]    = useState(800)
  const [headerCompact, setHeaderCompact] = useState(false)  // mode-tab icons only
  const [headerMinimal, setHeaderMinimal] = useState(false)  // right toolbar → ⋯ overflow
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false)

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const update = () => {
      const containerW = el.clientWidth
      setPanelWidth(containerW)

      // ── Header collision ──────────────────────────────────────────────────
      if (hdrRightRef.current) {
        const rightW    = hdrRightRef.current.offsetWidth
        const leftAvail = containerW - rightW - 24  // 24 = px-3 padding × 2
        // ModeTabBar full labels ≈ 310px. Hysteresis prevents flicker.
        setHeaderCompact(prev => prev ? leftAvail <= 370 : leftAvail < 326)
        setHeaderMinimal(prev => prev ? leftAvail <= 120 : leftAvail < 96)
      }

      // ── Bottom bar collision ──────────────────────────────────────────────
      if (btmRightRef.current) {
        const rightW    = btmRightRef.current.offsetWidth
        const leftAvail = containerW - rightW - 16  // 16 = px-1 padding × 2
        // Bottom-left full labels (folder + approve-edits + approve-cmds) ≈ 330px
        setBottomCompact(prev => prev ? leftAvail <= 380 : leftAvail < 330)
        setBottomMinimal(prev => prev ? leftAvail <= 120 : leftAvail < 96)
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Bottom-bar: same dynamic collision detection as the header
  const btmRightRef = useRef<HTMLDivElement>(null)
  const [bottomCompact, setBottomCompact] = useState(false)
  const [bottomMinimal, setBottomMinimal] = useState(false)

  // Overflow menu open state (top-right toolbar ⋯)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!overflowOpen) return
    const h = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node))
        setOverflowOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [overflowOpen])

  // Bottom-left overflow menu
  const [bottomOverflowOpen, setBottomOverflowOpen] = useState(false)
  const bottomOverflowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!bottomOverflowOpen) return
    const h = (e: MouseEvent) => {
      if (bottomOverflowRef.current && !bottomOverflowRef.current.contains(e.target as Node))
        setBottomOverflowOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [bottomOverflowOpen])

  // @-mention state
  const [mentionQuery,   setMentionQuery]   = useState<string | null>(null)  // null = inactive
  const [mentionAnchor,  setMentionAnchor]  = useState(0)                    // index of '@' in input
  const [mentionFiles,   setMentionFiles]   = useState<string[]>([])          // cached workspace paths
  const [mentionChips,   setMentionChips]   = useState<MentionFile[]>([])    // attached via @

  // Slash-command state
  const [slashQuery,     setSlashQuery]     = useState<string | null>(null)  // null = inactive
  const [slashAnchor,    setSlashAnchor]    = useState(0)                    // index of '/' in input
  const [slashActiveIdx, setSlashActiveIdx] = useState(0)

  const messagesEndRef      = useRef<HTMLDivElement>(null)
  const scrollContainerRef  = useRef<HTMLDivElement>(null)
  const textareaRef         = useRef<HTMLTextAreaElement>(null)
  const fileInputRef        = useRef<HTMLInputElement>(null)
  const dragCounter         = useRef(0)

  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const [mode, setMode] = useState<ConversationMode>(conversation?.mode ?? 'code')
  const [activityOpen, setActivityOpen] = useState(false)
  const [resumeBannerDismissed, setResumeBannerDismissed] = useState(false)

  // ── Per-conversation workspace folder ────────────────────────────────────
  const safeWorkspace = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined

  const [convWorkspace, setConvWorkspace] = useState<string | undefined>(
    safeWorkspace(conversation?.workspacePath) ?? safeWorkspace(initialWorkspacePath)
  )

  // Consume initialWorkspacePath once on mount for new chats
  useEffect(() => {
    if (!conversation && initialWorkspacePath) {
      setConvWorkspace(safeWorkspace(initialWorkspacePath))
      onWorkspacePathConsumed?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // Sync workspace when switching conversations
  useEffect(() => {
    setConvWorkspace(safeWorkspace(conversation?.workspacePath))
  }, [conversation?.id])

  // Notify parent whenever convWorkspace changes (so editor panel can follow)
  useEffect(() => {
    onWorkspaceChange?.(convWorkspace)
  }, [convWorkspace])

  const handlePickFolder = useCallback(async () => {
    if (!isElectron) return
    const result = await window.api.pickFolder()
    const picked = result?.path ?? null
    if (!picked) return
    setConvWorkspace(picked)
    if (conversation) {
      const updated = { ...conversation, workspacePath: picked }
      window.api.saveConversation(updated)
      onConversationUpdate(updated)
    }
  }, [conversation, onConversationUpdate])

  const handleClearFolder = useCallback(() => {
    setConvWorkspace(undefined)
    if (conversation) {
      const updated = { ...conversation, workspacePath: undefined }
      window.api.saveConversation(updated)
      onConversationUpdate(updated)
    }
  }, [conversation, onConversationUpdate])

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
    setResumeBannerDismissed(false)
  }, [conversation?.id])

  const {
    messages, isStreaming, isCompressing, sendMessage, editMessage,
    abortStream, rateMessage, effectiveSettings,
    autoContinueCount, agentPaused, pauseAgent, resumeAgent, maxAutoContiues
  } = useChat({
    conversation, settings, onConversationUpdate, mode, workspacePath: convWorkspace
  })

  const showResumeBanner = useMemo(() => {
    if (isStreaming) return false
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return false
    return !!(
      lastMsg.agentMode &&
      (lastMsg.error?.includes('Interrupted') || lastMsg.stopped) &&
      !lastMsg.content.trim().includes('All tasks complete')
    )
  }, [messages, isStreaming])

  // Consume initialScrollToMsgId on mount
  useEffect(() => {
    if (!initialScrollToMsgId) return
    setScrollToMsgId(initialScrollToMsgId)
    onScrollToMsgConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Expose focusInput / setInputText / scrollToMessage to parent
  useImperativeHandle(ref, () => ({
    focusInput: () => textareaRef.current?.focus(),
    setInputText: (text: string) => {
      setInput(prev => text + prev)
      setTimeout(() => textareaRef.current?.focus(), 50)
    },
    scrollToMessage: (msgId: string) => setScrollToMsgId(msgId),
  }))

  // Auto-send initialAgentTask in Agent mode (used by GitHub "Fix with Agent" button)
  useEffect(() => {
    if (!initialAgentTask) return
    setMode('agent')
    const timer = setTimeout(() => {
      sendMessage(initialAgentTask)
      onAgentTaskConsumed?.()
    }, 300)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track message count and last streaming state to detect "stream just finished"
  const prevMsgCountRef    = useRef(0)
  const prevWasStreamingRef = useRef(false)

  // Auto-scroll rules:
  //   • New message added (count increased)      → always scroll
  //   • Stream just finished (isStreaming → done) → always scroll (bubble grew with action row)
  //   • Streaming chunk arriving                  → scroll only if already near bottom
  //   • Any other update while scrolled up        → don't interrupt reading
  useEffect(() => {
    const el = scrollContainerRef.current
    const countChanged   = messages.length !== prevMsgCountRef.current
    const isNowStreaming = messages.some(m => m.isStreaming)
    const streamJustEnded = prevWasStreamingRef.current && !isNowStreaming

    prevMsgCountRef.current     = messages.length
    prevWasStreamingRef.current = isNowStreaming

    const scroll = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })

    if (!el) { scroll(); return }

    if (countChanged || streamJustEnded) {
      // New message added OR stream just finished — always jump to bottom
      scroll()
    } else if (isNowStreaming) {
      // Live streaming chunk — only follow if already near the bottom
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distFromBottom < 120) scroll()
    }
  }, [messages])

  // Show/hide scroll-to-bottom button
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(distFromBottom > 120)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

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
  // Use per-conversation workspace if set, else fall back to global settings
  const activeWorkspace = convWorkspace || settings.workspacePath

  const loadMentionFiles = useCallback(async () => {
    if (!isElectron || !activeWorkspace || mentionFiles.length > 0) return
    try {
      const files = await window.api.listWorkspaceFiles(activeWorkspace)
      setMentionFiles(files)
    } catch { /* silently ignore — mentions just won't work */ }
  }, [activeWorkspace, mentionFiles.length])

  // Refresh mention file list when workspace changes
  useEffect(() => {
    setMentionFiles([])
  }, [activeWorkspace])

  // Load .chatui project config when workspace changes
  useEffect(() => {
    if (!isElectron || !activeWorkspace) { setProjectConfig(null); return }
    window.api.getProjectConfig(activeWorkspace).then(cfg => setProjectConfig(cfg))
  }, [activeWorkspace])

  // Load pins count when workspace changes
  useEffect(() => {
    if (!isElectron || !activeWorkspace) { setPinsCount(0); return }
    window.api.readPins(activeWorkspace).then(({ pins }) => setPinsCount(pins.length))
  }, [activeWorkspace])

  // Load plugin count when workspace changes
  useEffect(() => {
    if (!isElectron || !activeWorkspace) { setPluginsCount(0); return }
    window.api.listPlugins(activeWorkspace).then(p => setPluginsCount(p.length)).catch(() => setPluginsCount(0))
  }, [activeWorkspace])

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

  // ── Image reading (drag-drop + file picker — NOT clipboard paste) ────────
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
      const mimeType = file.type as ImageMimeType
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        const base64  = dataUrl.split(',')[1]
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
  // Clipboard File objects are unreliable in Electron — we ask the main process
  // to read the image via the native `clipboard` module instead.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const hasImage = items.some(item => item.type.startsWith('image/'))
      if (!hasImage || !isElectron) return
      e.preventDefault()

      window.api.clipboardReadImage().then(result => {
        if (!result) { setFileError('No image found in clipboard'); return }
        const { dataUrl, base64, size } = result
        setAttachedImages(prev => {
          if (prev.length >= MAX_IMAGES) { setFileError(`Maximum ${MAX_IMAGES} images allowed`); return prev }
          return [...prev, {
            id:         `img-${Date.now()}`,
            name:       'Screenshot',
            mimeType:   'image/png',
            data:       base64,
            previewUrl: dataUrl,
            size
          }]
        })
      }).catch(() => setFileError('Failed to read clipboard image'))
    }
    textarea.addEventListener('paste', handlePaste)
    return () => textarea.removeEventListener('paste', handlePaste)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

    const textBefore = val.slice(0, cursor)

    // ── Slash command detection ───────────────────────────────────────────
    const slashIdx = textBefore.lastIndexOf('/')
    if (slashIdx >= 0) {
      const charBefore = slashIdx > 0 ? textBefore[slashIdx - 1] : ' '
      const isBoundary = /[\s]/.test(charBefore) || slashIdx === 0
      if (isBoundary) {
        const query = textBefore.slice(slashIdx + 1)
        if (!query.includes(' ') && !query.includes('\n')) {
          if (filterSlashCommands(query).length > 0) {
            setSlashQuery(query)
            setSlashAnchor(slashIdx)
            setSlashActiveIdx(0)
            setMentionQuery(null)
            return
          }
        }
      }
    }
    setSlashQuery(null)

    // ── @-mention detection ───────────────────────────────────────────────
    // Look for the last '@' before the cursor (not preceded by a word char — ensures
    // we only activate on a freshly typed '@', not mid-word)
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

  // ── Slash command: select handler ─────────────────────────────────────────
  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    // Replace the /query text with the command's prompt
    setInput(prev => prev.slice(0, slashAnchor) + cmd.prompt + prev.slice(slashAnchor + 1 + (slashQuery?.length ?? 0)))
    setSlashQuery(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [slashAnchor, slashQuery])

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

    // ── Pre-fetch detected URLs ───────────────────────────────────────────
    // Fetch via main-process net.fetch (bypasses CORS). Content is stored
    // in urlFetches on the ChatMessage — shown as collapsed cards in the UI
    // and injected into the AI's copy of the message automatically.
    let urlFetches: import('../../../shared/types').UrlFetch[] = []
    if (isElectron && detectedUrls.length > 0) {
      const results = await Promise.all(
        detectedUrls.map(async (url) => {
          try {
            const result = await window.api.fetchUrlContent(url)
            if (result.ok && result.content) return { url, content: result.content }
          } catch { /* best-effort */ }
          return null
        })
      )
      urlFetches = results.filter((r): r is import('../../../shared/types').UrlFetch => r !== null)
    }

    setInput('')
    try { localStorage.removeItem(`draft-${conversation?.id ?? 'new'}`) } catch { /* ignore */ }
    setAttachedFiles([])
    setMentionChips([])
    setAttachedImages([])
    setUrlBannerDismissed(false)
    await sendMessage(fullMessage, images.length > 0 ? images : undefined, urlFetches.length > 0 ? urlFetches : undefined)
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
      id:                   newConvId,
      title,
      messages:             branchedMessages,
      createdAt:            Date.now(),
      updatedAt:            Date.now(),
      provider:             effectiveSettings.provider,
      model:                effectiveSettings.model,
      workspacePath:        convWorkspace,           // preserve workspace folder
      mode:                 conversation?.mode,       // preserve chat mode
      parentConversationId: conversation?.id,         // record where this fork came from
      branchFromMessageId:  messageId,               // record the fork point
    }

    if (isElectron) await window.api.saveConversation(branchedConv)
    // onConversationUpdate adds the conv to the list and navigates to it
    onConversationUpdate(branchedConv)
  }, [messages, effectiveSettings, convWorkspace, conversation, onConversationUpdate])

  // ── Keyboard in textarea ──────────────────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ── Slash command navigation ────────────────────────────────────────────
    if (slashQuery !== null) {
      const cmds = filterSlashCommands(slashQuery)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashActiveIdx(i => Math.min(i + 1, cmds.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashActiveIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (cmds[slashActiveIdx]) handleSlashSelect(cmds[slashActiveIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashQuery(null)
        return
      }
    }

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

  const hasValidOAuth = settings.provider === 'openai'
    && !!settings.openaiOAuth?.accessToken
    && (settings.openaiOAuth.expiresAt ?? Infinity) > Date.now()
  const noApiKey = settings.provider === 'gemini'
    ? !settings.vertexProjectId
    : hasValidOAuth ? false : !settings.apiKey
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

  // ── Live activity: find the currently-running tool call ──────────────────
  const activeToolCall = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const running = msg.toolCalls.find(tc => tc.status === 'running')
        if (running) return running
      }
    }
    return null
  }, [messages])

  // ── Elapsed timer — ticks every second while streaming ───────────────────
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const streamStartRef = useRef<number | null>(null)
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isStreaming) {
      streamStartRef.current = Date.now()
      setElapsedSeconds(0)
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - (streamStartRef.current ?? Date.now())) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [isStreaming])

  // Format elapsed seconds as m:ss once ≥ 60s, else just "Xs"
  const elapsedLabel = elapsedSeconds >= 60
    ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
    : `${elapsedSeconds}s`

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={panelRef}
      className="flex flex-col h-full bg-gray-50 dark:bg-gray-950 relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Row 1 — drag handle (same height as native titlebar overlay) */}
      <div
        className="h-9 flex items-center px-4 bg-white dark:bg-gray-950 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Update available chip — sits in the drag row, no extra height consumed */}
        {(updateStatus?.type === 'available' || updateStatus?.type === 'downloading' || updateStatus?.type === 'downloaded') && (
          <div className="ml-auto mr-[138px] flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {updateStatus.type === 'downloading' ? (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
                <span className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Downloading… {'percent' in updateStatus ? `${updateStatus.percent}%` : ''}
              </span>
            ) : updateStatus.type === 'downloaded' ? (
              <button
                onClick={() => setShowUpdateConfirm(true)}
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors"
              >
                ✓ Ready to install v{updateStatus.version}
              </button>
            ) : (
              <button
                onClick={() => setShowUpdateConfirm(true)}
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
              >
                ↑ Update v{updateStatus.version} available
              </button>
            )}
          </div>
        )}
      </div>

      {/* Update confirmation dialog */}
      {showUpdateConfirm && updateStatus && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">
              {updateStatus.type === 'downloaded' ? 'Install update now?' : 'Download update?'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              {updateStatus.type === 'downloaded'
                ? `v${'version' in updateStatus ? updateStatus.version : ''} is ready. The app will restart to apply the update. Make sure you're not in the middle of something important.`
                : `v${'version' in updateStatus ? updateStatus.version : ''} is available. It will download in the background — you can keep working. The app will only restart when you choose to install.`
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUpdateConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Not now
              </button>
              <button
                onClick={() => {
                  setShowUpdateConfirm(false)
                  if (updateStatus.type === 'downloaded') onUpdateInstall?.()
                  else onUpdateDownload?.()
                }}
                className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
              >
                {updateStatus.type === 'downloaded' ? 'Restart & install' : 'Download'}
              </button>
            </div>
            {updateStatus.type !== 'downloaded' && (
              <button
                onClick={() => { setShowUpdateConfirm(false); onUpdateDismiss?.() }}
                className="w-full mt-2 py-1.5 text-xs text-gray-400 hover:text-gray-500 transition-colors"
              >
                Dismiss this update
              </button>
            )}
          </div>
        </div>
      )}

      {/* Row 2 — mode tabs (left) + toolbar (right) — responsive */}
      <div
        className="flex items-center justify-between px-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0 min-w-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: mode tabs + optional .chatui badge */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ModeTabBar mode={mode} onChange={handleModeChange} disabled={isStreaming} inline compact={headerCompact} />
          {projectConfig && !headerMinimal && (
            <span
              title={[
                projectConfig.model         ? `Model: ${projectConfig.model}`              : null,
                projectConfig.disabledTools?.length ? `Disabled: ${projectConfig.disabledTools.join(', ')}` : null,
                projectConfig.rules?.length ? `${projectConfig.rules.length} rule(s)`      : null,
              ].filter(Boolean).join('\n') || '.chatui config active'}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0
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

          {/* ── Branch origin pill — shown when this conversation is a fork ── */}
          {conversation?.parentConversationId && !headerMinimal && (
            <button
              onClick={() => onNavigateTo?.(conversation.parentConversationId!)}
              title="Go back to parent conversation"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0
                         bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400
                         border border-purple-200 dark:border-purple-700
                         hover:bg-purple-100 dark:hover:bg-purple-800/40 transition-colors cursor-pointer select-none"
            >
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0h8m0 0a3 3 0 100 6 3 3 0 000-6m0-12a3 3 0 100-6 3 3 0 000 6m0 6V9" />
              </svg>
              fork ↩
            </button>
          )}
        </div>

        {/* Right: toolbar — collapses to overflow ⋯ when very narrow */}
        <div ref={hdrRightRef} className="flex items-center gap-0.5 flex-shrink-0 ml-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>

          {/* Token/cost — full pill when wide, $ icon when compact */}
          {sessionTotalTokens > 0 && (
            headerCompact ? (
              <span
                title={`~${formatTokens(sessionTotalTokens)} tokens${showCost ? ` · ${formatCost(sessionCost)}` : ''}`}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 text-[11px] font-semibold cursor-default select-none hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                $
              </span>
            ) : (
              <span className="text-[10px] text-gray-400 dark:text-gray-600 px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 whitespace-nowrap">
                ~{formatTokens(sessionTotalTokens)} tokens{showCost && <> · {formatCost(sessionCost)}</>}
              </span>
            )
          )}

          {/* Primary tools — always visible, icon-only when compact */}
          {onSettingsUpdate && (
            <QuickTemplateMenu
              currentPrompt={settings.systemPrompt}
              onApply={(prompt) => { const next = { ...settings, systemPrompt: prompt }; onSettingsUpdate(next) }}
              compact={headerCompact}
            />
          )}
          <ExportMenu title={convTitle} messages={messages} conversation={conversation} disabled={messages.length === 0} compact={headerCompact} />

          {/* Secondary tools — visible when not minimal, otherwise in overflow */}
          {!headerMinimal && (<>
            {settings.workspacePath && (
              <button onClick={() => setSummaryOpen(true)} title="Project Summary"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                <span className="text-base leading-none">📄</span>
              </button>
            )}
            {settings.workspacePath && (
              <button onClick={() => setPinsOpen(true)} title="Pinned Context Files"
                className="relative w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors">
                <span className="text-base leading-none">📌</span>
                {pinsCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-orange-500 text-white text-[8px] font-bold flex items-center justify-center leading-none">{pinsCount}</span>
                )}
              </button>
            )}
            {settings.workspacePath && (
              <button onClick={() => setMemoryOpen(true)} title="Project Memory"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors">
                <span className="text-base leading-none">🧠</span>
              </button>
            )}
            <button onClick={() => onOpenEditor?.()} title="Code Editor"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </button>
            <button onClick={() => setTestRunnerOpen(true)} title="Test Runner"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors">
              <span className="text-base leading-none">🧪</span>
            </button>
            <button onClick={() => setDbBrowserOpen(true)} title="Database Browser"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors">
              <span className="text-base leading-none">🗄️</span>
            </button>
            <button onClick={() => setQueueOpen(v => !v)} title="Task Queue"
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${queueOpen ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`}>
              <span className="text-base leading-none">📋</span>
            </button>
            {messages.length > 0 && (
              <button
                onClick={() => setAuditOpen(true)}
                title="Session Audit Log — replay every step the AI took"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                </svg>
              </button>
            )}
            {pluginsCount > 0 && (
              <span title={`${pluginsCount} plugin${pluginsCount !== 1 ? 's' : ''}`}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-700 cursor-default select-none">
                🔌{pluginsCount}
              </span>
            )}
            {ragChunks > 0 && (
              <span title={`RAG: ${ragChunks} chunks`}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-700 cursor-default select-none">
                🔍{ragChunks}
              </span>
            )}
          </>)}

          {/* Overflow ⋯ — only in minimal mode, contains all secondary tools */}
          {headerMinimal && (
            <div ref={overflowRef} className="relative">
              <button
                onClick={() => setOverflowOpen(v => !v)}
                title="More tools"
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                  overflowOpen
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                    : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
                </svg>
              </button>
              {overflowOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-[60] w-52 py-1 overflow-hidden">
                  {settings.workspacePath && (
                    <button onClick={() => { setSummaryOpen(true); setOverflowOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <span>📄</span><span>Project Summary</span>
                    </button>
                  )}
                  {settings.workspacePath && (
                    <button onClick={() => { setPinsOpen(true); setOverflowOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <span>📌</span><span>Pinned Files {pinsCount > 0 && `(${pinsCount})`}</span>
                    </button>
                  )}
                  {settings.workspacePath && (
                    <button onClick={() => { setMemoryOpen(true); setOverflowOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <span>🧠</span><span>Project Memory</span>
                    </button>
                  )}
                  <button onClick={() => { onOpenEditor?.(); setOverflowOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    <span>Code Editor</span>
                  </button>
                  <button onClick={() => { setTestRunnerOpen(true); setOverflowOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <span>🧪</span><span>Test Runner</span>
                  </button>
                  <button onClick={() => { setDbBrowserOpen(true); setOverflowOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <span>🗄️</span><span>Database Browser</span>
                  </button>
                  <button onClick={() => { setQueueOpen(v => !v); setOverflowOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <span>📋</span><span>Task Queue</span>
                  </button>
                  {pluginsCount > 0 && (
                    <div className="px-3 py-2 text-xs text-violet-600 dark:text-violet-400">
                      🔌 {pluginsCount} plugin{pluginsCount !== 1 ? 's' : ''} active
                    </div>
                  )}
                  {ragChunks > 0 && (
                    <div className="px-3 py-2 text-xs text-teal-600 dark:text-teal-400">
                      🔍 RAG — {ragChunks} chunk{ragChunks !== 1 ? 's' : ''} injected
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages + Agent progress sidebar */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {mode === 'agent' && messages.length > 0 ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <AgentView
              messages={messages}
              isStreaming={isStreaming}
              autoContinueCount={autoContinueCount}
              maxContinues={maxAutoContiues}
              agentPaused={agentPaused}
              onPause={pauseAgent}
              onResume={resumeAgent}
              onStop={abortStream}
              onSendMessage={sendMessage}
            />
            {convWorkspace && (
              <DiagnosticsPanel workspacePath={convWorkspace} isDark={false} />
            )}
          </div>
        ) : (
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div
              ref={scrollContainerRef}
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
                  onOpenSettings={onOpenSettings}
                  activeWorkspace={activeWorkspace}
                  scrollToMsgId={scrollToMsgId}
                  onScrollConsumed={() => setScrollToMsgId(undefined)}
                />
              )}
            </div>

            {/* Scroll-to-bottom floating button */}
            {showScrollBtn && (
              <button
                onClick={() => {
                  scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' })
                }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 shadow-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-all duration-150"
                title="Scroll to latest"
                aria-label="Scroll to latest message"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
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

      {/* Live activity status pill + stop button — shown while streaming */}
      {isStreaming && (
        <div className="flex flex-col items-center gap-1.5 pb-2 flex-shrink-0">
          {/* Activity pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm text-xs text-gray-600 dark:text-gray-300 max-w-md">
            {activeToolCall ? (
              <>
                {/* Spinning ring */}
                <span className="flex-shrink-0 w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                <span className="text-sm leading-none">{toolIcon(activeToolCall.name)}</span>
                <span className="font-medium text-blue-600 dark:text-blue-400 truncate">
                  {toolLabel(activeToolCall.name)}
                </span>
                {/* Show path/arg if available */}
                {(() => {
                  const inp = activeToolCall.input as Record<string, unknown>
                  const arg = (inp.path ?? inp.command ?? inp.query ?? inp.url ?? inp.pattern)
                  if (typeof arg !== 'string' || !arg) return null
                  const short = arg.length > 35
                    ? '…' + arg.replace(/\\/g, '/').split('/').slice(-2).join('/')
                    : arg
                  return <span className="text-gray-400 dark:text-gray-500 truncate font-mono">· {short}</span>
                })()}
              </>
            ) : (
              <>
                {/* Pulsing dots for "thinking" */}
                <span className="flex gap-0.5 items-center flex-shrink-0">
                  <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
                <span className="font-medium text-blue-600 dark:text-blue-400">Thinking…</span>
              </>
            )}
            {/* Elapsed timer — separator + time */}
            <span className="flex-shrink-0 text-gray-300 dark:text-gray-600 select-none">·</span>
            <span className="flex-shrink-0 tabular-nums text-gray-400 dark:text-gray-500 font-mono">
              {elapsedLabel}
            </span>
          </div>

          {/* Stop button */}
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

      {/* Session resume banner */}
      {showResumeBanner && !resumeBannerDismissed && (
        <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center gap-3">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
          </svg>
          <span className="text-xs text-amber-800 dark:text-amber-300 flex-1">
            Agent session was interrupted. Resume from where it left off?
          </span>
          <button
            onClick={() => {
              setResumeBannerDismissed(true)
              if (mode !== 'agent') handleModeChange('agent')
              setTimeout(() => sendMessage('Continue the agent task from where you left off. Review the previous progress and resume the next uncompleted step.'), 100)
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
          >
            Resume
          </button>
          <button
            onClick={() => setResumeBannerDismissed(true)}
            className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Input area */}
      {mode !== 'voice' && (
      <div className="border-t border-gray-200 dark:border-gray-800 p-4 flex-shrink-0 bg-white dark:bg-gray-950 relative">

        {/* @-mention dropdown — rendered above input area */}
        {mentionQuery !== null && activeWorkspace && (
          <FileMentionDropdown
            query={mentionQuery}
            files={mentionFiles}
            onSelect={handleMentionSelect}
            onClose={() => setMentionQuery(null)}
          />
        )}

        {/* Slash-command menu — rendered above input area */}
        {slashQuery !== null && (
          <SlashCommandMenu
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={() => setSlashQuery(null)}
            activeIndex={slashActiveIdx}
            onActiveIndexChange={setSlashActiveIdx}
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
              noApiKey           ? 'Configure your API key in Settings first…' :
              totalChipCount > 0 ? 'Add a message… (optional)  ·  Paste more images or type @' :
              activeWorkspace    ? 'Message AI…  ·  Type / for commands  ·  @ to mention a file  ·  Enter ↵ to send' :
              'Message AI…  ·  Type / for commands  ·  Enter ↵ to send, Shift+Enter for newline'
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

        {/* Bottom bar — three columns: left | center | right */}
        <div className="flex items-center mt-2 px-1 gap-2 min-w-0">

          {/* Left: folder + approve toggles — icon-only when compact, overflow when minimal */}
          <div className="flex items-center gap-1 flex-shrink-0">

            {/* Folder chip */}
            {isElectron && (
              convWorkspace ? (
                <div className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300">
                  <button onClick={handlePickFolder} title={`Workspace: ${convWorkspace}\nClick to change`}
                    className="flex items-center gap-1 hover:text-violet-900 dark:hover:text-violet-100 transition-colors">
                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    </svg>
                  </button>
                  <button onClick={handleClearFolder} title="Remove folder"
                    className="flex-shrink-0 text-violet-400 hover:text-violet-700 dark:hover:text-violet-200 transition-colors">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <button onClick={handlePickFolder}
                  title="Add workspace folder — AI tools restricted to this folder"
                  className={`flex items-center gap-1 py-1 rounded-md text-xs font-medium text-gray-400 dark:text-gray-600 border border-dashed border-gray-300 dark:border-gray-700 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all ${bottomCompact ? 'px-1.5' : 'px-2'}`}>
                  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                  </svg>
                  {!bottomCompact && <span>Add folder</span>}
                </button>
              )
            )}

            {/* Approve-edits toggle — icon-only when compact */}
            {onSettingsUpdate && activeWorkspace && (
              <button
                onClick={() => onSettingsUpdate({ ...settings, requireEditApproval: settings.requireEditApproval === false ? true : false })}
                title={settings.requireEditApproval !== false ? 'Edit approval ON — click to disable' : 'Auto-write ON — click to require approval'}
                className={`flex items-center gap-1 py-1 rounded-md text-xs font-medium transition-all border ${bottomCompact ? 'px-1.5' : 'px-2 gap-1.5'}
                  ${settings.requireEditApproval !== false
                    ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                    : 'text-gray-400 dark:text-gray-600 bg-transparent border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                  }`}
              >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                {!bottomCompact && <span>{settings.requireEditApproval !== false ? 'Approve edits' : 'Auto-write'}</span>}
              </button>
            )}

            {/* Approve-commands toggle — icon-only when compact */}
            {onSettingsUpdate && activeWorkspace && (
              <button
                onClick={() => onSettingsUpdate({ ...settings, autoApproveCommands: !settings.autoApproveCommands })}
                title={settings.autoApproveCommands ? 'Auto-run cmds ON — click to require approval' : 'Approve cmds — click to auto-run'}
                className={`flex items-center gap-1 py-1 rounded-md text-xs font-medium transition-all border ${bottomCompact ? 'px-1.5' : 'px-2 gap-1.5'}
                  ${settings.autoApproveCommands
                    ? 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 hover:bg-orange-100'
                    : 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                  }`}
              >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 9 9 15"/><polyline points="9 12 15 12"/>
                </svg>
                {!bottomCompact && <span>{settings.autoApproveCommands ? 'Auto-run cmds' : 'Approve cmds'}</span>}
              </button>
            )}

            {/* YOLO mode toggle */}
            {onSettingsUpdate && activeWorkspace && (
              <button
                onClick={() => onSettingsUpdate({ ...settings, yoloMode: !settings.yoloMode })}
                title={settings.yoloMode ? 'YOLO: skip all approvals — click to restore safe mode' : 'Safe mode: require approvals — click for YOLO'}
                className={`flex items-center gap-1 py-1 rounded-md text-xs font-medium transition-all border ${bottomCompact ? 'px-1.5' : 'px-2 gap-1.5'}
                  ${settings.yoloMode
                    ? 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 hover:bg-red-100'
                    : 'text-gray-500 dark:text-gray-400 bg-transparent border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                  }`}
              >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                {!bottomCompact && <span>{settings.yoloMode ? 'YOLO' : 'Safe'}</span>}
              </button>
            )}

            {/* Structured output toggle */}
            {onSettingsUpdate && (
              <button
                onClick={() => onSettingsUpdate({ ...settings, structuredOutput: !settings.structuredOutput })}
                title={settings.structuredOutput ? 'Structured JSON output ON — click to disable' : 'Enable structured JSON output'}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  settings.structuredOutput
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 border border-violet-300 dark:border-violet-700'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'
                }`}
              >
                <span className="font-mono text-[11px]">{'{}'}</span>
                {!bottomCompact && <span>JSON</span>}
              </button>
            )}

            {/* Parallel agents toggle */}
            <button
              onClick={() => setShowParallelPanel(p => !p)}
              title="Run tasks in parallel"
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                showParallelPanel
                  ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border border-purple-300 dark:border-purple-700'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/>
              </svg>
              {!bottomCompact && <span>Parallel</span>}
            </button>

            {/* Live Preview toggle */}
            <button
              onClick={() => {
                if (!convWorkspace) {
                  alert('Set a workspace folder first to use Live Preview.')
                  return
                }
                setShowPreviewPanel(p => !p)
              }}
              title="Live app preview"
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                showPreviewPanel
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3"/>
              </svg>
              {!bottomCompact && <span>Preview</span>}
            </button>
          </div>

          {/* Center: quick action buttons — icon-only when compact */}
          <div className="flex-1 flex items-center justify-center gap-1 min-w-0 overflow-hidden">
            {quickActions.length > 0 && input.trim() === '' && totalChipCount === 0 && !isStreaming && (
              quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => { setInput(action.prompt); setTimeout(() => textareaRef.current?.focus(), 0) }}
                  title={action.label}
                  className={`flex items-center gap-1 rounded-md text-xs font-medium text-gray-400 dark:text-gray-600 border border-transparent hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 transition-colors flex-shrink-0 ${bottomCompact ? 'w-7 h-7 justify-center' : 'px-2 py-1 whitespace-nowrap'}`}
                >
                  <span className="text-sm leading-none flex-shrink-0">{action.icon}</span>
                  {!bottomCompact && <span className="truncate">{action.label}</span>}
                </button>
              ))
            )}
          </div>

          {/* Right: model picker + reasoning depth + token hint */}
          <div ref={btmRightRef} className="flex items-center gap-1 flex-shrink-0">
            {/* Token / attach hint — $ icon when compact, full text when wide */}
            {(input.length > 0 || attachedImages.length > 0 || totalChipCount > 0) && (
              bottomCompact ? (
                <span
                  title={
                    input.length > 0 || attachedImages.length > 0
                      ? `~${formatTokens(inputTokens)} tokens`
                      : `${totalChipCount} attached`
                  }
                  className="w-6 h-6 flex items-center justify-center text-[11px] font-semibold text-gray-400 cursor-default select-none"
                >
                  $
                </span>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-600">
                  {input.length > 0 || attachedImages.length > 0
                    ? `~${formatTokens(inputTokens)} tokens`
                    : `${totalChipCount} attached`
                  }
                </p>
              )
            )}
            {/* Clear — × icon when compact */}
            {totalChipCount > 0 && (
              bottomCompact ? (
                <button
                  onClick={() => { setAttachedFiles([]); setMentionChips([]); setAttachedImages([]) }}
                  title="Clear attachments"
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => { setAttachedFiles([]); setMentionChips([]); setAttachedImages([]) }}
                  className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  Clear
                </button>
              )
            )}

            {/* Reasoning depth — icon only when compact */}
            {onSettingsUpdate && (
              <ReasoningDepthPicker
                provider={effectiveSettings.provider}
                model={effectiveSettings.model}
                depth={(effectiveSettings.reasoningDepth ?? 'off') as 'off' | 'low' | 'medium' | 'high'}
                onChange={(d) => onSettingsUpdate({ ...settings, reasoningDepth: d })}
                compact={bottomCompact}
              />
            )}

            {/* Model picker — icon only when compact */}
            {onSettingsUpdate ? (
              <ModelPicker
                settings={effectiveSettings}
                openUp
                compact={bottomCompact}
                onApply={(model, provider) => {
                  const baseUrl = PROVIDER_BASE_URLS[provider] ?? settings.baseUrl
                  onSettingsUpdate({ ...settings, model, provider, baseUrl })
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

            {/* Context usage circle — always visible */}
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

      {/* Test Runner modal */}
      {testRunnerOpen && (
        <TestRunnerPanel
          workspacePath={activeWorkspace}
          onClose={() => setTestRunnerOpen(false)}
          onAutoFix={(prompt) => {
            setTestRunnerOpen(false)
            sendMessage(prompt)
          }}
        />
      )}

      {/* Database Browser modal */}
      {dbBrowserOpen && (
        <DatabaseBrowserPanel
          workspacePath={activeWorkspace}
          defaultConnStr={settings.dbConnectionString ?? ''}
          onClose={() => setDbBrowserOpen(false)}
          onAskAI={(prompt) => {
            setDbBrowserOpen(false)
            sendMessage(prompt)
          }}
        />
      )}

      {/* Session Audit Log modal */}
      {auditOpen && conversation && (
        <SessionReplayPanel
          conversation={conversation}
          onClose={() => setAuditOpen(false)}
          onJumpTo={(msgId) => {
            setAuditOpen(false)
            setScrollToMsgId(msgId)
          }}
        />
      )}

      {/* Parallel Agents panel — right-side drawer */}
      {showParallelPanel && isElectron && (
        <div className="absolute inset-y-0 right-0 z-30 flex flex-col shadow-2xl border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          style={{ width: 480 }}>
          <ParallelAgentPanel
            conversationId={conversation?.id ?? 'new'}
            settings={effectiveSettings}
            workspacePath={convWorkspace}
            onClose={() => setShowParallelPanel(false)}
          />
        </div>
      )}

      {/* Live Preview panel — right-side drawer */}
      {showPreviewPanel && convWorkspace && isElectron && (
        <div className="absolute inset-y-0 right-0 z-30 flex flex-col shadow-2xl border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          style={{ width: 420 }}>
          <LivePreviewPanel
            workspacePath={convWorkspace}
            onClose={() => setShowPreviewPanel(false)}
          />
        </div>
      )}
    </div>
  )
})

export default ChatWindow
