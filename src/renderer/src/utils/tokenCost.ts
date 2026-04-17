// ── Token estimation ──────────────────────────────────────────────────────────
// Rough approximation: ~4 characters per token (good enough for cost display)
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

// ── Pricing (USD per 1 M tokens, input / output) ──────────────────────────────
// Prices as of early 2025 — keep updated as models change
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6':    { input: 15,    output: 75   },
  'claude-sonnet-4-6':  { input: 3,     output: 15   },
  'claude-haiku-4-5':   { input: 0.25,  output: 1.25 },
  // OpenAI
  'gpt-4o':             { input: 5,     output: 15   },
  'gpt-4o-mini':        { input: 0.15,  output: 0.6  },
  'gpt-4-turbo':        { input: 10,    output: 30   },
  'gpt-3.5-turbo':      { input: 0.5,   output: 1.5  },
  // Gemini / Vertex AI
  'gemini-3.1-pro-preview':         { input: 1.25,  output: 5    },
  'gemini-2.5-pro-preview-05-06':   { input: 1.25,  output: 5    },
  'gemini-2.5-flash-preview-04-17': { input: 0.075, output: 0.3  },
  'gemini-2.0-flash-001':           { input: 0.1,   output: 0.4  },
  'gemini-2.0-flash-lite-001':      { input: 0.075, output: 0.3  },
  'gemini-1.5-pro-002':             { input: 1.25,  output: 5    },
  'gemini-1.5-flash-002':           { input: 0.075, output: 0.3  },
}

export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

export function formatCost(usd: number): string {
  if (usd === 0)      return '$0.00'
  if (usd < 0.00001)  return '<$0.00001'
  if (usd < 0.001)    return `$${usd.toFixed(5)}`
  if (usd < 0.01)     return `$${usd.toFixed(4)}`
  if (usd < 1)        return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function hasKnownPricing(model: string): boolean {
  return model in PRICING
}

// ── Context window limits (tokens) ────────────────────────────────────────────
// Values as of early 2025
const CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6':   200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5':  200_000,
  // OpenAI
  'gpt-4o':            128_000,
  'gpt-4o-mini':       128_000,
  'gpt-4-turbo':       128_000,
  'gpt-3.5-turbo':      16_385,
  // Gemini / Vertex AI
  'gemini-3.1-pro-preview':         1_000_000,
  'gemini-2.5-pro-preview-05-06':   1_000_000,
  'gemini-2.5-flash-preview-04-17': 1_000_000,
  'gemini-2.0-flash-001':           1_000_000,
  'gemini-2.0-flash-lite-001':      1_000_000,
  'gemini-1.5-pro-002':             2_000_000,
  'gemini-1.5-flash-002':           1_000_000,
}

/** Returns the context window size in tokens, or null if unknown. */
export function getContextLimit(model: string): number | null {
  return CONTEXT_LIMITS[model] ?? null
}

export type ContextWarningLevel = 'ok' | 'caution' | 'warning' | 'critical'

/**
 * Returns a severity level based on how full the context window is.
 *   ok       —  < 75 %
 *   caution  — 75–89 %
 *   warning  — 90–94 %
 *   critical — ≥ 95 %
 */
// ── Cost dashboard aggregation ────────────────────────────────────────────────

export interface ConversationCost {
  id:         string
  title:      string
  model:      string
  provider:   string
  date:       number    // updatedAt timestamp
  inputTokens:  number
  outputTokens: number
  costUsd:    number
}

export interface MonthlyCost {
  month:    string    // "2026-04"
  costUsd:  number
  convCount: number
}

/** Compute per-conversation cost from stored conversations */
export function computeConversationCosts(
  conversations: Array<{ id: string; title: string; model: string; provider: string; updatedAt: number; messages: Array<{ role: string; content: string }> }>
): ConversationCost[] {
  return conversations.map(conv => {
    let inputTokens  = 0
    let outputTokens = 0
    for (const msg of conv.messages) {
      const t = estimateTokens(msg.content)
      if (msg.role === 'user')      inputTokens  += t
      if (msg.role === 'assistant') outputTokens += t
    }
    return {
      id:      conv.id,
      title:   conv.title,
      model:   conv.model,
      provider: conv.provider,
      date:    conv.updatedAt,
      inputTokens,
      outputTokens,
      costUsd: estimateCost(inputTokens, outputTokens, conv.model)
    }
  }).sort((a, b) => b.date - a.date)
}

/** Group conversation costs into monthly buckets */
export function groupByMonth(costs: ConversationCost[]): MonthlyCost[] {
  const map = new Map<string, MonthlyCost>()
  for (const c of costs) {
    const month = new Date(c.date).toISOString().slice(0, 7)  // "2026-04"
    const existing = map.get(month)
    if (existing) {
      existing.costUsd  += c.costUsd
      existing.convCount += 1
    } else {
      map.set(month, { month, costUsd: c.costUsd, convCount: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month))
}

export function getContextWarning(
  usedTokens: number,
  model: string
): { level: ContextWarningLevel; pct: number; limit: number } | null {
  const limit = getContextLimit(model)
  if (!limit) return null
  const pct = usedTokens / limit
  if (pct < 0.75) return null
  const level: ContextWarningLevel =
    pct >= 0.95 ? 'critical' :
    pct >= 0.90 ? 'warning'  :
                  'caution'
  return { level, pct, limit }
}
