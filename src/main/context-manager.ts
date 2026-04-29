/**
 * Context window management with AI-powered compression.
 *
 * Strategy:
 *   1. Estimate token count of the full history
 *   2. If it exceeds COMPRESS_THRESHOLD (70% of model context window),
 *      split history into "old" (oldest 60%) + "recent" (newest 40%)
 *   3. Call the cheapest model for the provider to summarize the "old" portion
 *   4. Replace the "old" messages with a compact summary block
 *   5. Prepend summary to recent messages so the AI has full context
 *
 * Fallback: if summarization itself fails (API error, no key, etc.), fall back
 * to the original hard-trim approach so the request still goes through.
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI    from 'openai'
import { AppSettings, MessageRole, ImageAttachment } from '../shared/types'

// ── Context window sizes per model ────────────────────────────────────────────
const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6':    200_000,
  'claude-sonnet-4-6':  200_000,
  'claude-haiku-4-5':   200_000,
  // OpenAI — GPT-5 family (assumed 200K until official specs published)
  'gpt-5':              200_000,
  'gpt-5.1':            200_000,
  'gpt-5.2':            200_000,
  'gpt-5.3':            200_000,
  'gpt-5.4':            200_000,
  'gpt-5.5':            200_000,
  // OpenAI — GPT-4.1 family (1M context)
  'gpt-4.1':            1_047_576,
  'gpt-4.1-mini':       1_047_576,
  'gpt-4.1-nano':       1_047_576,
  // OpenAI — O-series reasoning
  'o4-mini':              200_000,
  'o3':                   200_000,
  'o3-mini':              200_000,
  'o1':                   200_000,
  'o1-mini':              128_000,
  'o1-preview':           128_000,
  // OpenAI — GPT-4o family
  'gpt-4o':               128_000,
  'gpt-4o-mini':          128_000,
  // OpenAI — Legacy
  'gpt-4-turbo':          128_000,
  'gpt-3.5-turbo':         16_385,
  // Gemini
  'gemini-3.1-pro-preview':         1_048_576,
  'gemini-2.5-pro-preview-05-06':   1_048_576,
  'gemini-2.5-flash-preview-04-17': 1_048_576,
  'gemini-2.0-flash-001':           1_048_576,
  'gemini-2.0-flash-lite-001':        262_144,
  'gemini-1.5-pro-002':             2_097_152,
  'gemini-1.5-flash-002':           1_048_576,
}

// Cheapest/fastest model per provider for the summarization call
const SUMMARY_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5',
  openai:    'gpt-4.1-nano',
  custom:    'gpt-4.1-nano',
  gemini:    'gemini-2.0-flash-lite-001',
}

const DEFAULT_CONTEXT    = 128_000
const COMPRESS_THRESHOLD = 0.70   // start compression at 70% full
const KEEP_RECENT_RATIO  = 0.40   // always keep the newest 40% of messages
const MIN_MESSAGES_TO_COMPRESS = 6  // don't bother unless there are enough messages

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export type Message = { role: MessageRole; content: string; images?: ImageAttachment[] }

// ── Summary prompt ─────────────────────────────────────────────────────────
const SUMMARY_SYSTEM = `You are a conversation summarizer. Produce a dense, structured summary of a conversation segment that will be injected into an AI assistant's context. Preserve everything technically relevant: decisions made, code written, file paths, error messages, tech stack details, open questions, and any facts the AI needs to continue helpfully. Be concise but complete. Output only the summary — no preamble.`

const buildSummaryPrompt = (msgs: Message[]): string => {
  const formatted = msgs
    .filter(m => m.role !== 'system')
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n')
  return `Summarize the following conversation segment:\n\n${formatted}`
}

// ── Provider-specific one-shot summarization ──────────────────────────────
async function callSummaryModel(msgs: Message[], settings: AppSettings): Promise<string> {
  const provider    = settings.provider
  const summaryModel = SUMMARY_MODELS[provider] ?? settings.model
  const prompt      = buildSummaryPrompt(msgs)

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: settings.apiKey })
    const res = await client.messages.create({
      model:      summaryModel,
      max_tokens: 1024,
      system:     SUMMARY_SYSTEM,
      messages:   [{ role: 'user', content: prompt }]
    })
    const block = res.content[0]
    return block.type === 'text' ? block.text : ''
  }

  if (provider === 'openai' || provider === 'custom') {
    const client = new OpenAI({
      apiKey:  settings.apiKey,
      baseURL: settings.baseUrl
    })
    const res = await client.chat.completions.create({
      model:      summaryModel,
      max_tokens: 1024,
      messages: [
        { role: 'system',  content: SUMMARY_SYSTEM },
        { role: 'user',    content: prompt }
      ]
    })
    return res.choices[0]?.message?.content ?? ''
  }

  if (provider === 'gemini') {
    // Use Anthropic-style but via REST isn't practical here; use same model via OpenAI compat
    // Google AI Studio has an OpenAI-compatible endpoint
    const client = new OpenAI({
      apiKey:  settings.apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
    })
    const res = await client.chat.completions.create({
      model:      summaryModel,
      max_tokens: 1024,
      messages: [
        { role: 'system',  content: SUMMARY_SYSTEM },
        { role: 'user',    content: prompt }
      ]
    })
    return res.choices[0]?.message?.content ?? ''
  }

  return ''
}

// ── Main export: async compression ────────────────────────────────────────
export async function compressToContextWindow(
  messages: Message[],
  model:    string,
  settings: AppSettings,
  onCompressingStart?: () => void
): Promise<{ messages: Message[]; wasCompressed: boolean; wasTrimmed: boolean }> {

  const contextWindow = CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT
  const tokenLimit    = Math.floor(contextWindow * COMPRESS_THRESHOLD)

  const systemMsg  = messages.find(m => m.role === 'system')
  const convoMsgs  = messages.filter(m => m.role !== 'system')

  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + (m.images?.length ?? 0) * 1000,
    0
  )

  // Under threshold — no action needed
  if (totalTokens <= tokenLimit) {
    return { messages, wasCompressed: false, wasTrimmed: false }
  }

  // Not enough messages to meaningfully compress
  if (convoMsgs.length < MIN_MESSAGES_TO_COMPRESS) {
    return { messages, wasCompressed: false, wasTrimmed: false }
  }

  // Notify UI that compression is actually starting
  onCompressingStart?.()

  // Split: summarize oldest 60%, keep newest 40%
  const keepCount  = Math.max(4, Math.floor(convoMsgs.length * KEEP_RECENT_RATIO))
  const oldMsgs    = convoMsgs.slice(0, convoMsgs.length - keepCount)
  const recentMsgs = convoMsgs.slice(convoMsgs.length - keepCount)

  if (oldMsgs.length === 0) {
    // Nothing old enough to summarize — fall back to hard trim
    return fallbackTrim(messages, systemMsg, convoMsgs)
  }

  try {
    const summary = await callSummaryModel(oldMsgs, settings)

    if (!summary.trim()) {
      return fallbackTrim(messages, systemMsg, convoMsgs)
    }

    const summaryBlock: Message = {
      role:    'user',
      content: `[Earlier conversation summary — ${oldMsgs.length} messages compressed]\n\n${summary}\n\n[End of summary — conversation continues below]`
    }

    // Inject a brief acknowledgment so alternating user/assistant order stays valid
    const summaryAck: Message = {
      role:    'assistant',
      content: 'Understood. I have the summary of our earlier conversation and will continue from there.'
    }

    const compressed: Message[] = [
      ...(systemMsg ? [systemMsg] : []),
      summaryBlock,
      summaryAck,
      ...recentMsgs
    ]

    return { messages: compressed, wasCompressed: true, wasTrimmed: false }

  } catch {
    // Summarization failed — fall back to hard trim so the request still goes through
    return fallbackTrim(messages, systemMsg, convoMsgs)
  }
}

function fallbackTrim(
  original: Message[],
  systemMsg: Message | undefined,
  convoMsgs: Message[]
): { messages: Message[]; wasCompressed: boolean; wasTrimmed: boolean } {
  const keepCount = Math.max(4, Math.floor(convoMsgs.length * KEEP_RECENT_RATIO))
  const kept      = convoMsgs.slice(-keepCount)
  const dropped   = convoMsgs.length - kept.length

  if (dropped === 0) return { messages: original, wasCompressed: false, wasTrimmed: false }

  const trimNotice: Message = {
    role:    'user',
    content: `[System notice: ${dropped} earlier message(s) were removed to fit within the context window. The conversation continues from the most recent ${kept.length} messages.]`
  }

  return {
    messages: [
      ...(systemMsg ? [systemMsg] : []),
      trimNotice,
      ...kept
    ],
    wasCompressed: false,
    wasTrimmed: true
  }
}

// ── Kept for backwards compat (used in unit tests / other callers) ─────────
export function trimToContextWindow(
  messages: Message[],
  model: string
): { messages: Message[]; wasTrimmed: boolean } {
  const contextWindow = CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT
  const tokenLimit    = Math.floor(contextWindow * COMPRESS_THRESHOLD)
  const systemMsg     = messages.find(m => m.role === 'system')
  const convoMsgs     = messages.filter(m => m.role !== 'system')

  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + (m.images?.length ?? 0) * 1000,
    0
  )
  if (totalTokens <= tokenLimit) return { messages, wasTrimmed: false }

  const result = fallbackTrim(messages, systemMsg, convoMsgs)
  return { messages: result.messages, wasTrimmed: result.wasTrimmed }
}
