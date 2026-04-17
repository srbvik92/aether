import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react'
import { AppSettings, Conversation, PROVIDER_MODELS } from '../../../shared/types'
import { useChat } from '../hooks/useChat'
import MessageBubble from './MessageBubble'

interface Props {
  settings: AppSettings
  onConversationUpdate?: (conv: Conversation) => void
  onClose?: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveSecondModel(settings: AppSettings): AppSettings {
  const models = PROVIDER_MODELS[settings.provider] ?? []
  const currentIdx = models.indexOf(settings.model)

  // If there's another model in the same provider list, use the next one
  if (models.length > 1) {
    const nextIdx = currentIdx === -1 ? 1 : (currentIdx + 1) % models.length
    return { ...settings, model: models[nextIdx] }
  }

  return { ...settings }
}

function displayModelName(model: string, provider: string): string {
  if (provider === 'anthropic') {
    return model
      .replace(/^claude-/, '')
      .replace(/-(\d)/g, ' $1')
      .replace(/-/g, ' ')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  if (provider === 'openai') {
    return model.replace(/^gpt-/, 'GPT-').replace(/-turbo$/, ' Turbo').replace(/-mini$/, ' Mini')
  }
  if (provider === 'gemini') {
    return model
      .replace(/^gemini-/, '')
      .replace(/-preview-\d+-\d+$/, ' (preview)')
      .replace(/-\d+$/, '')
      .replace(/-/g, ' ')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  return model
}

// ── Panel header model selector ───────────────────────────────────────────────

interface PanelHeaderProps {
  label: string
  panelSettings: AppSettings
  globalSettings: AppSettings
  onChange: (model: string) => void
  isStreaming: boolean
  messageCount: number
}

function PanelHeader({ label, panelSettings, globalSettings, onChange, isStreaming, messageCount }: PanelHeaderProps) {
  const models = PROVIDER_MODELS[globalSettings.provider] ?? [panelSettings.model]

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
      {/* Panel label badge */}
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 w-6 flex-shrink-0">
        {label}
      </span>

      {/* Model dropdown */}
      <select
        value={panelSettings.model}
        onChange={e => onChange(e.target.value)}
        disabled={isStreaming}
        className="flex-1 min-w-0 text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded-md
                   px-2 py-1 text-gray-700 dark:text-gray-300
                   hover:border-blue-400 dark:hover:border-blue-600
                   focus:outline-none focus:ring-1 focus:ring-blue-500
                   disabled:opacity-50 disabled:cursor-not-allowed
                   cursor-pointer transition-colors"
      >
        {models.map(m => (
          <option key={m} value={m}>
            {displayModelName(m, globalSettings.provider)} — {m}
          </option>
        ))}
      </select>

      {/* Provider tag */}
      <span className="text-[10px] text-gray-400 dark:text-gray-600 capitalize flex-shrink-0">
        {globalSettings.provider}
      </span>

      {/* Streaming indicator */}
      {isStreaming && (
        <span className="flex items-center gap-1 text-[10px] text-blue-500 dark:text-blue-400 flex-shrink-0">
          <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          streaming
        </span>
      )}

      {/* Message count */}
      {messageCount > 0 && !isStreaming && (
        <span className="text-[10px] text-gray-400 dark:text-gray-600 flex-shrink-0">
          {Math.floor(messageCount / 2)} exchange{Math.floor(messageCount / 2) !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-600 select-none px-6 text-center">
      <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
        <span className="text-lg font-bold text-gray-300 dark:text-gray-600">{label}</span>
      </div>
      <p className="text-sm font-medium text-gray-400 dark:text-gray-500">Waiting for a message</p>
      <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">
        Type a prompt below to compare responses
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CompareView({ settings, onConversationUpdate, onClose }: Props) {
  const [leftSettings,  setLeftSettings]  = useState<AppSettings>(() => ({ ...settings }))
  const [rightSettings, setRightSettings] = useState<AppSettings>(() => deriveSecondModel(settings))
  const [leftConv,      setLeftConv]      = useState<Conversation | null>(null)
  const [rightConv,     setRightConv]     = useState<Conversation | null>(null)
  const [input,         setInput]         = useState('')

  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const leftEndRef   = useRef<HTMLDivElement>(null)
  const rightEndRef  = useRef<HTMLDivElement>(null)

  // Keep panel settings provider in sync if global provider changes
  useEffect(() => {
    setLeftSettings(prev => ({ ...prev, provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl }))
    setRightSettings(prev => ({ ...prev, provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl }))
  }, [settings.provider, settings.apiKey, settings.baseUrl])

  // ── useChat instances ────────────────────────────────────────────────────
  const leftChat = useChat({
    conversation: leftConv,
    settings: leftSettings,
    onConversationUpdate: (c) => {
      setLeftConv(c)
      onConversationUpdate?.(c)
    }
  })

  const rightChat = useChat({
    conversation: rightConv,
    settings: rightSettings,
    onConversationUpdate: (c) => {
      setRightConv(c)
      onConversationUpdate?.(c)
    }
  })

  const isStreaming = leftChat.isStreaming || rightChat.isStreaming

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    leftEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [leftChat.messages])

  useEffect(() => {
    rightEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rightChat.messages])

  // ── Auto-resize textarea ─────────────────────────────────────────────────
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px'
    }
  }, [input])

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    leftChat.sendMessage(trimmed)
    rightChat.sendMessage(trimmed)
    setInput('')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [input, isStreaming, leftChat, rightChat])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Clear both panels ────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    leftChat.clearMessages()
    rightChat.clearMessages()
    setLeftConv(null)
    setRightConv(null)
    setInput('')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [leftChat, rightChat])

  const noApiKey = settings.provider === 'gemini'
    ? !settings.vertexProjectId
    : !settings.apiKey

  const canSend = input.trim().length > 0 && !noApiKey && !isStreaming

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">

      {/* ── Top bar (drag region) ─────────────────────────────────────────── */}
      <div
        className="h-9 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Title */}
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 tracking-tight">
            Model Comparison
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-600 font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
            {settings.provider}
          </span>
        </div>

        {/* Right: clear button */}
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {(leftChat.messages.length > 0 || rightChat.messages.length > 0) && !isStreaming && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400
                         hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                         transition-colors"
              title="Clear both panels"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400
                         hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800
                         transition-colors"
              title="Exit comparison view"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Exit
            </button>
          )}
        </div>
      </div>

      {/* ── Two-panel body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-gray-200 dark:border-gray-800">
          <PanelHeader
            label="A"
            panelSettings={leftSettings}
            globalSettings={settings}
            onChange={model => setLeftSettings(prev => ({ ...prev, model }))}
            isStreaming={leftChat.isStreaming}
            messageCount={leftChat.messages.length}
          />

          <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 dark:bg-gray-950">
            {leftChat.messages.length === 0 ? (
              <EmptyPanel label="A" />
            ) : (
              <>
                {leftChat.messages.map((msg, idx) => {
                  const isLastAI = msg.role === 'assistant' && idx === leftChat.messages.length - 1 && !msg.isStreaming
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      settings={leftSettings}
                      isLastAI={isLastAI}
                      chatStreaming={leftChat.isStreaming}
                    />
                  )
                })}
                <div ref={leftEndRef} />
              </>
            )}
          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">
          <PanelHeader
            label="B"
            panelSettings={rightSettings}
            globalSettings={settings}
            onChange={model => setRightSettings(prev => ({ ...prev, model }))}
            isStreaming={rightChat.isStreaming}
            messageCount={rightChat.messages.length}
          />

          <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 dark:bg-gray-950">
            {rightChat.messages.length === 0 ? (
              <EmptyPanel label="B" />
            ) : (
              <>
                {rightChat.messages.map((msg, idx) => {
                  const isLastAI = msg.role === 'assistant' && idx === rightChat.messages.length - 1 && !msg.isStreaming
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      settings={rightSettings}
                      isLastAI={isLastAI}
                      chatStreaming={rightChat.isStreaming}
                    />
                  )
                })}
                <div ref={rightEndRef} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Stop button (shown while either panel is streaming) ──────────── */}
      {isStreaming && (
        <div className="flex justify-center py-2 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0">
          <button
            onClick={() => { leftChat.abortStream(); rightChat.abortStream() }}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600
                       shadow-md hover:shadow-lg text-sm text-gray-700 dark:text-gray-200
                       hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-300 dark:hover:border-red-700
                       hover:text-red-600 dark:hover:text-red-400 transition-all"
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-current flex-shrink-0" />
            Stop both
          </button>
        </div>
      )}

      {/* ── Shared input area ─────────────────────────────────────────────── */}
      <div className="border-t border-gray-200 dark:border-gray-800 p-4 flex-shrink-0 bg-white dark:bg-gray-950">

        {/* API key warning */}
        {noApiKey && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20
                          border border-yellow-200 dark:border-yellow-800 rounded-lg text-xs
                          text-yellow-700 dark:text-yellow-400">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            Configure your API key in Settings to use model comparison.
          </div>
        )}

        {/* Hint row */}
        <div className="flex items-center gap-2 mb-2 text-[10px] text-gray-400 dark:text-gray-600 select-none">
          <svg className="w-3 h-3 text-indigo-400 dark:text-indigo-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>The same prompt is sent to both models simultaneously.</span>
          <span className="ml-auto">
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[9px] font-mono">Enter</kbd>
            {' '}to send &nbsp;·&nbsp;
            <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[9px] font-mono">Shift+Enter</kbd>
            {' '}for newline
          </span>
        </div>

        {/* Input row */}
        <div className="flex items-end gap-2 bg-gray-100 dark:bg-gray-800 rounded-2xl px-3 py-3
                        focus-within:ring-1 focus-within:ring-blue-500 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming || noApiKey}
            placeholder={noApiKey ? 'Configure API key in Settings…' : 'Send the same prompt to both models…'}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-gray-800 dark:text-gray-100
                       placeholder-gray-400 dark:placeholder-gray-600
                       disabled:opacity-50 disabled:cursor-not-allowed
                       max-h-[180px] overflow-y-auto leading-relaxed"
          />

          {/* Send / streaming state button */}
          <button
            onClick={isStreaming ? () => { leftChat.abortStream(); rightChat.abortStream() } : handleSend}
            disabled={!isStreaming && !canSend}
            title={isStreaming ? 'Stop both streams' : 'Send to both models (Enter)'}
            className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all
              ${isStreaming
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : canSend
                  ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm hover:shadow-md'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed'
              }`}
          >
            {isStreaming ? (
              /* Stop square */
              <span className="w-3 h-3 rounded-sm bg-white flex-shrink-0" />
            ) : (
              /* Send arrow */
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
