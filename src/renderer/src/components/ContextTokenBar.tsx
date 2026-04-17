import { useMemo } from 'react'
import { AppSettings, ChatMessage } from '../../../shared/types'

interface Props {
  settings: AppSettings
  messages: ChatMessage[]
}

// Approximate context window per model
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6':                  200_000,
  'claude-sonnet-4-6':                200_000,
  'claude-haiku-4-5':                 200_000,
  'gpt-4o':                           128_000,
  'gpt-4o-mini':                      128_000,
  'gpt-4-turbo':                      128_000,
  'gpt-3.5-turbo':                     16_000,
  'gemini-3.1-pro-preview':         1_000_000,
  'gemini-2.5-pro-preview-05-06':   1_000_000,
  'gemini-2.5-flash-preview-04-17': 1_000_000,
  'gemini-2.0-flash-001':           1_000_000,
  'gemini-2.0-flash-lite-001':      1_000_000,
  'gemini-1.5-pro-002':             2_000_000,
  'gemini-1.5-flash-002':           1_000_000,
}

function est(text: string): number {
  return Math.ceil((text ?? '').length / 4)
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`
  return `${n}`
}

// ── Compact circular context indicator (used in the bottom bar) ───────────────
export function ContextCircle({ settings, messages }: Props) {
  const { model, systemPrompt } = settings
  const contextWindow = CONTEXT_WINDOWS[model] ?? 128_000

  const { sysT, msgT } = useMemo(() => {
    const sysT = est(systemPrompt ?? '')
    const msgT = messages.reduce((sum, m) => {
      let t = est(m.content)
      m.toolCalls?.forEach(tc => {
        t += est(JSON.stringify(tc.input))
        t += est(tc.output ?? '')
      })
      return sum + t
    }, 0)
    return { sysT, msgT }
  }, [systemPrompt, messages])

  // Only count actual consumed tokens — NOT the output reservation (maxTokens)
  const totalUsed = sysT + msgT
  const usedPct   = Math.min(100, (totalUsed / contextWindow) * 100)
  const headroom  = Math.max(0, contextWindow - totalUsed)

  // Circle geometry
  const size   = 14
  const r      = 5
  const cx     = size / 2
  const cy     = size / 2
  const circ   = 2 * Math.PI * r
  const filled = circ * (usedPct / 100)
  const empty  = circ - filled

  // Color ramp: green → yellow → orange → red
  const color =
    usedPct >= 90 ? '#ef4444' :
    usedPct >= 75 ? '#f97316' :
    usedPct >= 60 ? '#f59e0b' :
    '#22c55e'

  const tooltip = [
    `Context: ${Math.round(usedPct)}% used`,
    `System prompt: ~${fmt(sysT)} tokens`,
    `Messages: ~${fmt(msgT)} tokens`,
    `Remaining: ~${fmt(headroom)} tokens`,
    `Window: ${fmt(contextWindow)} tokens`,
  ].join('\n')

  return (
    <div
      className="flex items-center gap-1 cursor-default"
      title={tooltip}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          strokeWidth={2.5}
          className="stroke-gray-200 dark:stroke-gray-700"
        />
        {/* Fill */}
        {usedPct > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            strokeWidth={2.5}
            stroke={color}
            strokeDasharray={`${filled} ${empty}`}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span
        className="text-[10px] tabular-nums"
        style={{ color: usedPct >= 75 ? color : undefined }}
        // default gray when not yet concerning
      >
        <span className={usedPct < 75 ? 'text-gray-400 dark:text-gray-600' : ''}>
          {fmt(headroom)}
        </span>
      </span>
    </div>
  )
}

// ── Full bar (kept for backwards compat but no longer rendered) ───────────────
export default function ContextTokenBar({ settings, messages }: Props) {
  // This component is no longer rendered — the ContextCircle in the bottom bar
  // replaced it. Returning null avoids any layout shift.
  return null
}
