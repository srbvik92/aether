import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  AppSettings,
  ChatMessage,
  Conversation,
  ConversationMode,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  RateLimitRetryPayload,
  ToolCallStartPayload,
  ToolCallResultPayload,
  ToolOutputChunkPayload,
  ContextCompressingPayload,
  SessionChangesPayload,
  ToolCallDisplay,
  ImageAttachment,
  CmdApprovalPayload,
  DiffAttachPayload
} from '../../../shared/types'

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

interface UseChatOptions {
  conversation:         Conversation | null
  settings:             AppSettings
  onConversationUpdate: (conv: Conversation) => void
  mode?:                ConversationMode
  workspacePath?:       string   // per-conversation folder (overrides conversation.workspacePath)
}

// ── Agent mode auto-continue detection ──────────────────────────────────────
const MAX_AUTO_CONTINUES = 20

function detectAgentShouldContinue(content: string): boolean {
  // Stop signals — the AI explicitly says it's done
  const donePatterns = [
    /all\s+(tasks?|steps?)\s+(are\s+)?(complete|done|finished)/i,
    /implementation\s+is\s+(complete|done|finished)/i,
    /everything\s+(is\s+)?(complete|done|finished)/i,
    /that\s+completes?\s+(the|all)/i,
    /task\s+is\s+fully\s+(complete|done)/i,
    /all\s+tasks?\s+are\s+complete/i
  ]
  if (donePatterns.some(r => r.test(content))) return false

  // Continue signals — unchecked items or explicit intent to continue
  const continuePatterns = [
    /- \[ \]/,                           // unchecked markdown checkboxes
    /next,?\s+I('ll| will)/i,
    /let me (continue|proceed|move on)/i,
    /moving on to/i,
    /now I('ll| will)/i,
    /I'll\s+(now\s+)?(start|begin|work on|implement|create|add|update|fix)/i,
    /proceeding\s+(to|with)/i
  ]
  if (continuePatterns.some(r => r.test(content))) return true

  return false
}

/** Clean up any tool calls / messages left in a "running" state from a previous session. */
function sanitiseLoadedMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs.map(m => {
    const hasStale = m.isStreaming || m.toolCalls?.some(tc => tc.status === 'running')
    if (!hasStale) return m
    return {
      ...m,
      isStreaming: false,
      toolCalls: m.toolCalls?.map(tc =>
        tc.status === 'running'
          ? { ...tc, status: 'error' as const, output: 'Interrupted — app was restarted.' }
          : tc
      )
    }
  })
}

export function useChat({ conversation, settings, onConversationUpdate, mode = 'code', workspacePath }: UseChatOptions) {
  const [messages,      setMessages]      = useState<ChatMessage[]>(sanitiseLoadedMessages(conversation?.messages ?? []))
  const [isStreaming,   setIsStreaming]   = useState(false)
  const [isCompressing, setIsCompressing] = useState(false)
  // Always initialise with a real ID — for new chats we pre-generate one so
  // activeConvId never changes when the first message is sent (which would tear
  // down and re-register all stream listeners mid-flight, dropping every chunk).
  const [activeConvId,  setActiveConvId]  = useState<string>(() => conversation?.id ?? genId())

  const streamingIdRef      = useRef<string | null>(null)
  const autoTitledRef       = useRef(false)
  const streamSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [customTitle,   setCustomTitle]   = useState<string | null>(null)

  // ── Agent mode auto-continue state ────────────────────────────────────────
  const autoContinueCountRef  = useRef(0)
  const autoContinueTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentPausedRef        = useRef(false)
  const [autoContinueCount, setAutoContinueCount] = useState(0)
  const [agentPaused,       setAgentPaused]       = useState(false)
  const modeRef = useRef(mode)
  modeRef.current = mode

  // Reset state when switching conversations; sanitise any stale "running" tool calls.
  // IMPORTANT: skip the reset when the incoming conversation.id is the same as the
  // id we already pre-generated for this new chat.  That happens when the first
  // message of a brand-new chat triggers onConversationUpdate → setActiveConvId in
  // App.tsx, which causes the conversation prop to go from null → saved conv.
  // We do NOT want to wipe streaming state in that case — it's the same chat.
  useEffect(() => {
    if (conversation?.id && conversation.id === activeConvIdRef.current) {
      // Same conversation we're already tracking — nothing to reset.
      return
    }
    autoTitledRef.current = false
    setCustomTitle(null)
    setMessages(sanitiseLoadedMessages(conversation?.messages ?? []))
    setIsStreaming(false)
    setIsCompressing(false)
    streamingIdRef.current = null
    // Keep activeConvId in sync when the user switches to a different conversation.
    // For new chats (conversation?.id is undefined) we keep the pre-generated UUID.
    if (conversation?.id) setActiveConvId(conversation.id)
  }, [conversation?.id])

  // ── Per-conversation model lock ───────────────────────────────────────────
  // For existing conversations (those that have messages saved), honour the
  // model/provider they were started with.  However, if the user explicitly
  // picks a different model/provider via the ModelPicker mid-conversation
  // (onSettingsUpdate + saveConversation are called together), the conversation
  // record is updated first — so settings.model/provider will equal
  // conversation.model/provider after the update and we use settings directly.
  // This means "global settings drift" (e.g. changing provider in another tab)
  // still can't accidentally swap the model for an existing conversation, but an
  // intentional per-conversation switch always takes effect immediately.
  const effectiveSettings: AppSettings = useMemo(() => {
    if (conversation?.messages.length && conversation.model && conversation.provider) {
      // If settings match what was just saved to the conversation, use settings
      // (covers the mid-conversation provider/model switch case).
      // Otherwise fall back to the conversation's stored values.
      const providerMatch = settings.provider === conversation.provider
      const modelMatch    = settings.model    === conversation.model
      if (providerMatch && modelMatch) return settings
      return { ...settings, provider: conversation.provider, model: conversation.model }
    }
    return settings
  }, [settings, conversation?.model, conversation?.provider, conversation?.messages?.length])

  // ── Refs for values the listeners need — always current, no stale closures ──
  // Listeners are registered ONCE on mount (empty deps). All dynamic values are
  // read through refs so no teardown/re-register cycle can drop mid-flight events.
  const activeConvIdRef     = useRef(activeConvId)
  const effectiveSettingsRef = useRef(effectiveSettings)
  activeConvIdRef.current      = activeConvId        // updated every render, sync
  effectiveSettingsRef.current = effectiveSettings

  // ── Stream + tool listeners — registered ONCE, torn down on unmount only ──
  useEffect(() => {
    const ok = (id: string) => id === activeConvIdRef.current

    // Text chunk — also clears any rate-limit countdown (retry succeeded)
    window.api.onStreamChunk((payload: StreamChunkPayload) => {
      if (!ok(payload.conversationId)) return
      setIsCompressing(false)
      setMessages(prev => prev.map(m =>
        m.id === streamingIdRef.current
          ? { ...m, content: m.content + payload.chunk, rateLimitRetry: undefined }
          : m
      ))
    })

    // Rate-limit countdown — updates the streaming bubble with seconds remaining
    window.api.onRateLimitRetry((payload: RateLimitRetryPayload) => {
      if (!ok(payload.conversationId)) return
      setMessages(prev => prev.map(m =>
        m.id === streamingIdRef.current
          ? { ...m, rateLimitRetry: { secondsLeft: payload.secondsLeft, attempt: payload.attempt, maxAttempts: payload.maxAttempts } }
          : m
      ))
    })

    // Stream done
    window.api.onStreamDone((payload: StreamDonePayload) => {
      if (!ok(payload.conversationId)) return
      if (streamSafetyTimerRef.current) { clearTimeout(streamSafetyTimerRef.current); streamSafetyTimerRef.current = null }
      setIsCompressing(false)
      setMessages(prev => {
        const updated = prev.map(m => {
          if (m.id === streamingIdRef.current) return { ...m, isStreaming: false, rateLimitRetry: undefined }
          if (m.isStreaming) return { ...m, isStreaming: false, rateLimitRetry: undefined }
          return m
        })
        if (!autoTitledRef.current) {
          const aiCount   = updated.filter(m => m.role === 'assistant').length
          const firstUser = updated.find(m => m.role === 'user')
          if (aiCount === 1 && firstUser?.content) {
            autoTitledRef.current = true
            setTimeout(() => {
              window.api.autoTitleConversation(firstUser.content.slice(0, 400), effectiveSettingsRef.current)
                .then(r => { if (r.ok && r.title) setCustomTitle(r.title) })
                .catch(() => {})
            }, 0)
          }
        }
        return updated
      })

      // Agent auto-continue
      if (modeRef.current === 'agent') {
        setMessages(latest => {
          const lastAI = [...latest].reverse().find(m => m.role === 'assistant')
          if (lastAI && !lastAI.error && !lastAI.stopped) {
            const hasContent   = lastAI.content.trim().length > 0
            const hasToolCalls = (lastAI.toolCalls?.length ?? 0) > 0
            if (!hasContent && !hasToolCalls) {
              return latest.map(m => m.id === lastAI.id
                ? { ...m, error: 'Agent returned an empty response. Click Retry to try again.' }
                : m)
            }
            const shouldContinue = detectAgentShouldContinue(lastAI.content)
            if (shouldContinue && autoContinueCountRef.current < MAX_AUTO_CONTINUES && !agentPausedRef.current) {
              autoContinueTimerRef.current = setTimeout(() => {
                autoContinueCountRef.current++
                setAutoContinueCount(autoContinueCountRef.current)
                window.dispatchEvent(new CustomEvent('agent-continue', { detail: { convId: payload.conversationId } }))
              }, 600)
            } else if (!shouldContinue) {
              autoContinueCountRef.current = 0
              setAutoContinueCount(0)
            }
          }
          return latest
        })
      }

      streamingIdRef.current = null
      setIsStreaming(false)
    })

    // Stream error
    window.api.onStreamError((payload: StreamErrorPayload) => {
      if (!ok(payload.conversationId)) return
      if (streamSafetyTimerRef.current) { clearTimeout(streamSafetyTimerRef.current); streamSafetyTimerRef.current = null }
      setIsCompressing(false)
      setMessages(prev => {
        let matched = false
        const mapped = prev.map(m => {
          if (m.id === streamingIdRef.current) {
            matched = true
            const hasWork = m.content.trim().length > 0 || (m.toolCalls && m.toolCalls.length > 0)
            return { ...m, isStreaming: false, error: payload.error, content: hasWork ? m.content : '' }
          }
          if (m.isStreaming) { matched = true; return { ...m, isStreaming: false, error: payload.error } }
          return m
        })
        if (!matched && streamingIdRef.current) {
          return [...mapped, { id: streamingIdRef.current, role: 'assistant' as const, content: '', timestamp: Date.now(), isStreaming: false, error: payload.error }]
        }
        return mapped
      })
      streamingIdRef.current = null
      setIsStreaming(false)
    })

    // Tool call start
    window.api.onToolCallStart((payload: ToolCallStartPayload) => {
      if (!ok(payload.conversationId)) return
      const newCall: ToolCallDisplay = { id: payload.callId, name: payload.name, input: payload.input, isError: false, status: 'running' }
      setMessages(prev => prev.map(m =>
        m.id === streamingIdRef.current ? { ...m, toolCalls: [...(m.toolCalls ?? []), newCall] } : m
      ))
    })

    // Tool call result
    window.api.onToolCallResult((payload: ToolCallResultPayload) => {
      if (!ok(payload.conversationId)) return
      setMessages(prev => prev.map(m =>
        m.id === streamingIdRef.current
          ? { ...m, toolCalls: (m.toolCalls ?? []).map(tc =>
              tc.id === payload.callId
                ? { ...tc, output: payload.output, liveOutput: undefined, isError: payload.isError, status: payload.isError ? 'error' : 'done' }
                : tc) }
          : m
      ))
    })

    // Tool output chunk (live terminal)
    window.api.onToolOutputChunk((payload: ToolOutputChunkPayload) => {
      if (!ok(payload.conversationId)) return
      setMessages(prev => prev.map(m =>
        m.id === streamingIdRef.current
          ? { ...m, toolCalls: (m.toolCalls ?? []).map(tc =>
              tc.id === payload.callId ? { ...tc, liveOutput: (tc.liveOutput ?? '') + payload.chunk } : tc) }
          : m
      ))
    })

    // Context compressing
    window.api.onContextCompressing((payload: ContextCompressingPayload) => {
      if (!ok(payload.conversationId)) return
      setIsCompressing(true)
    })

    // Session changes (changed files / snapshot)
    window.api.onSessionChanges((payload: SessionChangesPayload) => {
      if (!ok(payload.conversationId)) return
      setMessages(prev => prev.map(m =>
        m.id === streamingIdRef.current ? { ...m, changedFiles: payload.files, snapshotId: payload.snapshotId } : m
      ))
    })

    // DOM events (cmd approval, diff attach, agent continue) — no conv-id filter needed
    const cmdApprovalHandler = (e: Event) => {
      const payload = (e as CustomEvent<CmdApprovalPayload>).detail
      if (!payload.callId) return
      setMessages(prev => prev.map(m => ({
        ...m,
        toolCalls: m.toolCalls?.map(tc =>
          tc.id === payload.callId ? { ...tc, status: 'awaiting-approval' as const, approvalId: payload.id } : tc
        )
      })))
    }
    const diffAttachHandler = (e: Event) => {
      const { diffId, callId, payload } = (e as CustomEvent<DiffAttachPayload>).detail
      setMessages(prev => prev.map(m => ({
        ...m,
        toolCalls: m.toolCalls?.map(tc =>
          tc.id === callId ? { ...tc, status: 'awaiting-approval' as const, diffPayload: payload, diffId } : tc
        )
      })))
    }
    const handleAgentContinue = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.convId === activeConvIdRef.current) {
        setTimeout(() => window.dispatchEvent(new CustomEvent('agent-send-continue')), 50)
      }
    }
    window.addEventListener('cmd-approval-pending', cmdApprovalHandler)
    window.addEventListener('diff-attach', diffAttachHandler)
    window.addEventListener('agent-continue', handleAgentContinue)

    return () => {
      window.removeEventListener('cmd-approval-pending', cmdApprovalHandler)
      window.removeEventListener('diff-attach', diffAttachHandler)
      window.removeEventListener('agent-continue', handleAgentContinue)
      window.api.removeStreamListeners()
      setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
      setIsStreaming(false)
      setIsCompressing(false)
      streamingIdRef.current = null
      if (autoContinueTimerRef.current) { clearTimeout(autoContinueTimerRef.current); autoContinueTimerRef.current = null }
      if (streamSafetyTimerRef.current) { clearTimeout(streamSafetyTimerRef.current); streamSafetyTimerRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // ← empty: register once on mount, never re-run

  // ── Persist conversation on every message change ──────────────────────────
  useEffect(() => {
    if (messages.length === 0 || !activeConvId) return
    const conv: Conversation = {
      id:        activeConvId,
      title:     customTitle ?? deriveTitle(messages),
      messages,
      createdAt: conversation?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      // Preserve the locked model/provider (effectiveSettings resolves it correctly)
      provider:  effectiveSettings.provider,
      model:     effectiveSettings.model,
      mode:      modeRef.current,
      // Preserve per-conversation folder — prefer live prop, fall back to stored value
      workspacePath: workspacePath ?? conversation?.workspacePath,
    }
    window.api.saveConversation(conv)
    onConversationUpdate(conv)
  }, [messages, customTitle])

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string, images?: ImageAttachment[], urlFetches?: import('../../../shared/types').UrlFetch[]) => {
      const hasContent = text.trim().length > 0 || (images && images.length > 0)
      if (!hasContent || isStreaming) return

      const convId = activeConvId

      const userMsg: ChatMessage = {
        id:        genId(),
        role:      'user',
        content:   text.trim(),
        timestamp: Date.now(),
        ...(images     && images.length > 0     ? { images }     : {}),
        ...(urlFetches && urlFetches.length > 0 ? { urlFetches } : {}),
      }

      const aiMsgId = genId()
      const aiMsg: ChatMessage = {
        id:          aiMsgId,
        role:        'assistant',
        content:     '',
        timestamp:   Date.now(),
        isStreaming: true,
        toolCalls:   [],
        agentMode:   modeRef.current === 'agent' || undefined
      }

      streamingIdRef.current = aiMsgId
      setIsStreaming(true)
      // Clear any previously-stuck streaming messages before adding new ones
      setMessages(prev => [
        ...prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m),
        userMsg,
        aiMsg
      ])

      // Safety valve: if STREAM_DONE/ERROR never arrives (e.g. IPC event lost),
      // auto-reset streaming state after 5 minutes so the UI doesn't stay frozen.
      if (streamSafetyTimerRef.current) clearTimeout(streamSafetyTimerRef.current)
      streamSafetyTimerRef.current = setTimeout(() => {
        if (streamingIdRef.current === aiMsgId) {
          setMessages(prev => prev.map(m =>
            m.isStreaming ? { ...m, isStreaming: false, error: m.error ?? 'Stream timed out — no response received.' } : m
          ))
          streamingIdRef.current = null
          setIsStreaming(false)
        }
      }, 5 * 60 * 1000)

      const history = [...messages, userMsg].map(m => {
        // For user messages that have pre-fetched URL content, append it to the
        // AI's copy of the message so the model sees the full page text.
        // The displayed message (m.content) stays clean — only urlFetches holds the raw text.
        const urlContext = m.urlFetches?.length
          ? '\n\n' + m.urlFetches.map(f =>
              `---\nFetched content from ${f.url}:\n\n${f.content}\n---`
            ).join('\n\n')
          : ''
        return {
          role:    m.role,
          content: m.content + urlContext,
          ...(m.images && m.images.length > 0 ? { images: m.images } : {})
        }
      })

      try {
        await window.api.sendMessage({ conversationId: convId, messages: history, settings: effectiveSettings, mode: modeRef.current, workspacePath: workspacePath ?? conversation?.workspacePath })
      } catch (err) {
        // IPC invoke itself threw (e.g. main process error before stream started)
        const errorMsg = err instanceof Error ? err.message : 'Failed to send message'
        if (streamSafetyTimerRef.current) { clearTimeout(streamSafetyTimerRef.current); streamSafetyTimerRef.current = null }
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId
            ? { ...m, isStreaming: false, error: errorMsg }
            : m
        ))
        streamingIdRef.current = null
        setIsStreaming(false)
      }
    },
    [messages, isStreaming, activeConvId, effectiveSettings, workspacePath, conversation?.workspacePath]
  )

  // ── Edit (truncates history after the edited message, re-sends) ──────────
  const editMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (isStreaming) return
      const idx = messages.findIndex(m => m.id === messageId)
      if (idx < 0) return

      const convId = activeConvId

      // Preserve any images attached to the original message
      const original      = messages[idx]
      const historyBefore = messages.slice(0, idx)

      const userMsg: ChatMessage = {
        id:        genId(),
        role:      'user',
        content:   newContent.trim(),
        timestamp: Date.now(),
        ...(original.images?.length ? { images: original.images } : {})
      }

      const aiMsgId = genId()
      const aiMsg: ChatMessage = {
        id:          aiMsgId,
        role:        'assistant',
        content:     '',
        timestamp:   Date.now(),
        isStreaming: true,
        toolCalls:   [],
        agentMode:   modeRef.current === 'agent' || undefined
      }

      streamingIdRef.current = aiMsgId
      setIsStreaming(true)
      setMessages([...historyBefore, userMsg, aiMsg])

      // Build history directly (don't rely on stale state)
      const history = [...historyBefore, userMsg].map(m => ({
        role:    m.role,
        content: m.content,
        ...(m.images?.length ? { images: m.images } : {})
      }))

      try {
        await window.api.sendMessage({ conversationId: convId, messages: history, settings: effectiveSettings, mode: modeRef.current, workspacePath: workspacePath ?? conversation?.workspacePath })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to send message'
        setMessages(prev => prev.map(m =>
          m.id === aiMsgId
            ? { ...m, isStreaming: false, error: errorMsg }
            : m
        ))
        streamingIdRef.current = null
        setIsStreaming(false)
      }
    },
    [messages, isStreaming, activeConvId, effectiveSettings, workspacePath, conversation?.workspacePath]
  )

  // ── Rate a message (👍/👎) ────────────────────────────────────────────────
  const rateMessage = useCallback((messageId: string, rating: 'up' | 'down') => {
    setMessages(prev =>
      prev.map(m =>
        m.id === messageId
          ? { ...m, rating: m.rating === rating ? undefined : rating }  // toggle off if same
          : m
      )
    )
  }, [])

  // ── Abort ─────────────────────────────────────────────────────────────────
  const abortStream = useCallback(() => {
    if (activeConvId) {
      window.api.abortMessage(activeConvId)
      setIsStreaming(false)
      setMessages(prev =>
        prev.map(m => {
          // Clear the streaming message (exact match or any stuck streaming message)
          if (m.id === streamingIdRef.current || m.isStreaming) {
            return {
              ...m,
              isStreaming: false,
              stopped: true,
              // Terminate any tool calls that were still running when stopped
              toolCalls: m.toolCalls?.map(tc =>
                tc.status === 'running' || tc.status === 'awaiting-approval'
                  ? { ...tc, status: 'stopped' as const }
                  : tc
              ),
            }
          }
          return m
        })
      )
      streamingIdRef.current = null
    }
    // Clear timers
    if (autoContinueTimerRef.current) { clearTimeout(autoContinueTimerRef.current); autoContinueTimerRef.current = null }
    if (streamSafetyTimerRef.current) { clearTimeout(streamSafetyTimerRef.current); streamSafetyTimerRef.current = null }
    autoContinueCountRef.current = 0
    setAutoContinueCount(0)
    agentPausedRef.current = false
    setAgentPaused(false)
  }, [activeConvId])

  // ── Agent pause / resume ──────────────────────────────────────────────────
  const pauseAgent = useCallback(() => {
    agentPausedRef.current = true
    setAgentPaused(true)
    if (autoContinueTimerRef.current) { clearTimeout(autoContinueTimerRef.current); autoContinueTimerRef.current = null }
  }, [])

  const resumeAgent = useCallback(() => {
    agentPausedRef.current = false
    setAgentPaused(false)
    // Immediately check if we should continue from where we paused
    const lastAI = [...messages].reverse().find(m => m.role === 'assistant')
    if (lastAI && !isStreaming && detectAgentShouldContinue(lastAI.content)) {
      autoContinueCountRef.current++
      setAutoContinueCount(autoContinueCountRef.current)
      window.dispatchEvent(new CustomEvent('agent-send-continue'))
    }
  }, [messages, isStreaming])

  // ── Agent continue event → send next message ─────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (modeRef.current === 'agent' && !isStreaming) {
        sendMessage('Continue with the next step.')
      }
    }
    window.addEventListener('agent-send-continue', handler)
    return () => window.removeEventListener('agent-send-continue', handler)
  }, [sendMessage, isStreaming])

  const clearMessages = useCallback(() => {
    setMessages([])
    streamingIdRef.current = null
    setIsStreaming(false)
    // Reset agent state
    autoContinueCountRef.current = 0
    setAutoContinueCount(0)
    agentPausedRef.current = false
    setAgentPaused(false)
  }, [])

  return {
    messages, isStreaming, isCompressing, sendMessage, editMessage,
    abortStream, clearMessages, rateMessage, effectiveSettings,
    // Agent mode state
    autoContinueCount, agentPaused, pauseAgent, resumeAgent,
    maxAutoContiues: MAX_AUTO_CONTINUES
  }
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return 'New Chat'
  if (firstUser.content.trim()) {
    return firstUser.content.trim().slice(0, 50) + (firstUser.content.length > 50 ? '…' : '')
  }
  if (firstUser.images?.length) {
    return `Image${firstUser.images.length > 1 ? 's' : ''} — ${new Date(firstUser.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
  return 'New Chat'
}
