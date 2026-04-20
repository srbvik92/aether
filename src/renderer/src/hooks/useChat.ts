import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  AppSettings,
  ChatMessage,
  Conversation,
  ConversationMode,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  ToolCallStartPayload,
  ToolCallResultPayload,
  ToolOutputChunkPayload,
  ContextCompressingPayload,
  SessionChangesPayload,
  ToolCallDisplay,
  ImageAttachment,
  CmdApprovalPayload
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
  const [activeConvId,  setActiveConvId]  = useState<string | null>(conversation?.id ?? null)

  const streamingIdRef  = useRef<string | null>(null)
  const autoTitledRef   = useRef(false)
  const [customTitle,   setCustomTitle]   = useState<string | null>(null)

  // ── Agent mode auto-continue state ────────────────────────────────────────
  const autoContinueCountRef  = useRef(0)
  const autoContinueTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const agentPausedRef        = useRef(false)
  const [autoContinueCount, setAutoContinueCount] = useState(0)
  const [agentPaused,       setAgentPaused]       = useState(false)
  const modeRef = useRef(mode)
  modeRef.current = mode

  // Reset state when switching conversations; sanitise any stale "running" tool calls
  useEffect(() => {
    autoTitledRef.current = false
    setCustomTitle(null)
    setMessages(sanitiseLoadedMessages(conversation?.messages ?? []))
    setIsStreaming(false)
    setIsCompressing(false)
    streamingIdRef.current = null
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

  // ── Stream + tool listeners ───────────────────────────────────────────────
  useEffect(() => {
    // Text chunk
    window.api.onStreamChunk((payload: StreamChunkPayload) => {
      if (payload.conversationId !== activeConvId) return
      setIsCompressing(false)   // first token arrived — compression done
      setMessages(prev =>
        prev.map(m =>
          m.id === streamingIdRef.current
            ? { ...m, content: m.content + payload.chunk }
            : m
        )
      )
    })

    // Stream done
    window.api.onStreamDone((payload: StreamDonePayload) => {
      if (payload.conversationId !== activeConvId) return
      setIsCompressing(false)
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m
        )

        // Fire auto-title after the first completed AI response (once per mount)
        if (!autoTitledRef.current) {
          const aiCount   = updated.filter(m => m.role === 'assistant').length
          const firstUser = updated.find(m => m.role === 'user')
          if (aiCount === 1 && firstUser?.content) {
            autoTitledRef.current = true
            setTimeout(() => {
              window.api.autoTitleConversation(
                firstUser.content.slice(0, 400),
                effectiveSettings
              ).then(result => {
                if (result.ok && result.title) setCustomTitle(result.title)
              }).catch(() => { /* silently ignore title failures */ })
            }, 0)
          }
        }

        return updated
      })
      // ── Agent auto-continue ────────────────────────────────────────────
      if (modeRef.current === 'agent') {
        setMessages(latest => {
          const lastAI = [...latest].reverse().find(m => m.role === 'assistant')
          if (lastAI && !lastAI.error && !lastAI.stopped) {
            const shouldContinue = detectAgentShouldContinue(lastAI.content)
            const turnCount      = autoContinueCountRef.current
            if (shouldContinue && turnCount < MAX_AUTO_CONTINUES && !agentPausedRef.current) {
              autoContinueTimerRef.current = setTimeout(() => {
                autoContinueCountRef.current++
                setAutoContinueCount(autoContinueCountRef.current)
                // Use a custom event to trigger the next send without a circular dep
                window.dispatchEvent(new CustomEvent('agent-continue', { detail: { convId: payload.conversationId } }))
              }, 600)
            } else if (!shouldContinue) {
              // Agent finished — reset counter
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

    // Stream error — keep whatever the AI already produced (text + tool calls),
    // just mark it done and attach the error so it renders below the partial response.
    window.api.onStreamError((payload: StreamErrorPayload) => {
      if (payload.conversationId !== activeConvId) return
      setIsCompressing(false)
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== streamingIdRef.current) return m
          // If there's already content or tool calls, preserve them and append the error.
          // If nothing arrived yet (empty message), replace with error only.
          const hasWork = m.content.trim().length > 0 || (m.toolCalls && m.toolCalls.length > 0)
          return {
            ...m,
            isStreaming: false,
            error: payload.error,
            // Keep existing content; clear it only if nothing was produced at all
            content: hasWork ? m.content : ''
          }
        })
      )
      streamingIdRef.current = null
      setIsStreaming(false)
    })

    // Tool call starting — add to the current AI message's toolCalls array
    window.api.onToolCallStart((payload: ToolCallStartPayload) => {
      if (payload.conversationId !== activeConvId) return
      const newCall: ToolCallDisplay = {
        id:      payload.callId,
        name:    payload.name,
        input:   payload.input,
        isError: false,
        status:  'running'
      }
      setMessages(prev =>
        prev.map(m =>
          m.id === streamingIdRef.current
            ? { ...m, toolCalls: [...(m.toolCalls ?? []), newCall] }
            : m
        )
      )
    })

    // Command approval pending — flip the tool card to awaiting-approval state.
    // App.tsx holds the single IPC listener and re-dispatches as a DOM event,
    // so we listen here without competing with the modal listener.
    const cmdApprovalHandler = (e: Event) => {
      const payload = (e as CustomEvent<CmdApprovalPayload>).detail
      if (!payload.callId) return
      setMessages(prev =>
        prev.map(m => ({
          ...m,
          toolCalls: m.toolCalls?.map(tc =>
            tc.id === payload.callId
              ? { ...tc, status: 'awaiting-approval' as const, approvalId: payload.id }
              : tc
          )
        }))
      )
    }
    window.addEventListener('cmd-approval-pending', cmdApprovalHandler)

    // Tool call result — update the matching call in the current AI message
    window.api.onToolCallResult((payload: ToolCallResultPayload) => {
      if (payload.conversationId !== activeConvId) return
      setMessages(prev =>
        prev.map(m =>
          m.id === streamingIdRef.current
            ? {
                ...m,
                toolCalls: (m.toolCalls ?? []).map(tc =>
                  tc.id === payload.callId
                    ? { ...tc, output: payload.output, liveOutput: undefined, isError: payload.isError, status: payload.isError ? 'error' : 'done' }
                    : tc
                )
              }
            : m
        )
      )
    })

    // Context compression starting — show a status indicator
    window.api.onContextCompressing((payload: ContextCompressingPayload) => {
      if (payload.conversationId !== activeConvId) return
      setIsCompressing(true)
      // Will be cleared by onStreamChunk (first token arrives) or onStreamError/Done
    })

    // Session change summary — attach changed files + snapshot ID to the current AI message
    window.api.onSessionChanges((payload: SessionChangesPayload) => {
      if (payload.conversationId !== activeConvId) return
      setMessages(prev =>
        prev.map(m =>
          m.id === streamingIdRef.current
            ? { ...m, changedFiles: payload.files, snapshotId: payload.snapshotId }
            : m
        )
      )
    })

    // Streaming output chunk from run_command — append to liveOutput buffer
    window.api.onToolOutputChunk((payload: ToolOutputChunkPayload) => {
      if (payload.conversationId !== activeConvId) return
      setMessages(prev =>
        prev.map(m =>
          m.id === streamingIdRef.current
            ? {
                ...m,
                toolCalls: (m.toolCalls ?? []).map(tc =>
                  tc.id === payload.callId
                    ? { ...tc, liveOutput: (tc.liveOutput ?? '') + payload.chunk }
                    : tc
                )
              }
            : m
        )
      )
    })

    // ── Agent auto-continue event listener ─────────────────────────────
    const handleAgentContinue = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.convId === activeConvId) {
        // Dispatch a sendMessage for "Continue with the next step."
        // We trigger this asynchronously after the streaming state has cleared
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('agent-send-continue'))
        }, 50)
      }
    }
    window.addEventListener('agent-continue', handleAgentContinue)

    return () => {
      window.removeEventListener('agent-continue', handleAgentContinue)
      window.removeEventListener('cmd-approval-pending', cmdApprovalHandler)
      window.api.removeStreamListeners()
      // Clear any message that got stuck with isStreaming:true when listeners are torn down
      setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m))
      setIsStreaming(false)
      setIsCompressing(false)
      streamingIdRef.current = null
      // Clear auto-continue timer
      if (autoContinueTimerRef.current) { clearTimeout(autoContinueTimerRef.current); autoContinueTimerRef.current = null }
    }
  }, [activeConvId])

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
    async (text: string, images?: ImageAttachment[]) => {
      const hasContent = text.trim().length > 0 || (images && images.length > 0)
      if (!hasContent || isStreaming) return

      const convId = activeConvId ?? genId()
      if (!activeConvId) setActiveConvId(convId)

      const userMsg: ChatMessage = {
        id:        genId(),
        role:      'user',
        content:   text.trim(),
        timestamp: Date.now(),
        ...(images && images.length > 0 ? { images } : {})
      }

      const aiMsgId = genId()
      const aiMsg: ChatMessage = {
        id:          aiMsgId,
        role:        'assistant',
        content:     '',
        timestamp:   Date.now(),
        isStreaming: true,
        toolCalls:   []
      }

      streamingIdRef.current = aiMsgId
      setIsStreaming(true)
      // Clear any previously-stuck streaming messages before adding new ones
      setMessages(prev => [
        ...prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m),
        userMsg,
        aiMsg
      ])

      const history = [...messages, userMsg].map(m => ({
        role:    m.role,
        content: m.content,
        ...(m.images && m.images.length > 0 ? { images: m.images } : {})
      }))

      try {
        await window.api.sendMessage({ conversationId: convId, messages: history, settings: effectiveSettings, mode: modeRef.current, workspacePath: workspacePath ?? conversation?.workspacePath })
      } catch (err) {
        // IPC invoke itself threw (e.g. main process error before stream started)
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
    [messages, isStreaming, activeConvId, effectiveSettings]
  )

  // ── Edit (truncates history after the edited message, re-sends) ──────────
  const editMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (isStreaming) return
      const idx = messages.findIndex(m => m.id === messageId)
      if (idx < 0) return

      const convId = activeConvId ?? genId()
      if (!activeConvId) setActiveConvId(convId)

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
        toolCalls:   []
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
    [messages, isStreaming, activeConvId, effectiveSettings]
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
        prev.map(m =>
          m.id === streamingIdRef.current
            ? { ...m, isStreaming: false, stopped: true }
            : m
        )
      )
      streamingIdRef.current = null
    }
    // Clear agent auto-continue
    if (autoContinueTimerRef.current) { clearTimeout(autoContinueTimerRef.current); autoContinueTimerRef.current = null }
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
    setActiveConvId(null)
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
