/**
 * DiffViewer modal — shown when the AI wants to write a file.
 *
 * Renders a unified diff (green = added, red = removed, gray = unchanged).
 * Shows only changed regions (hunks) with ±3 lines of context — same as
 * `git diff` output.  Full file shown for small files (< 60 lines).
 *
 * Actions:
 *   • Approve     — write this file (Enter)
 *   • Accept All  — approve this + all future writes in the session without prompting
 *   • Reject      — skip this write (Esc)
 */

import { useMemo, useState } from 'react'
import { DiffRequestPayload } from '../../../shared/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type DiffLine =
  | { type: 'added';     content: string; oldNo: number | null; newNo: number }
  | { type: 'removed';   content: string; oldNo: number;        newNo: number | null }
  | { type: 'unchanged'; content: string; oldNo: number;        newNo: number }
  | { type: 'hunk';      label: string }   // @@ separator between hunks

interface Props {
  payload:      DiffRequestPayload
  onApprove:    () => void
  onAcceptAll:  () => void
  onReject:     () => void
}

// ── LCS diff ──────────────────────────────────────────────────────────────────

type Op = { type: 'unchanged' | 'removed' | 'added'; content: string }

function computeOps(before: string, after: string): Op[] {
  const a = before ? before.split('\n') : []
  const b = after  ? after.split('\n')  : []

  if (before === after) return a.map(c => ({ type: 'unchanged', content: c }))

  // For very large files use full replace to avoid O(n²) LCS
  if (a.length > 500 || b.length > 500) {
    return [
      ...a.map(c => ({ type: 'removed' as const, content: c })),
      ...b.map(c => ({ type: 'added'   as const, content: c })),
    ]
  }

  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])

  const ops: Op[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      ops.unshift({ type: 'unchanged', content: a[i-1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ type: 'added',   content: b[j-1] }); j--
    } else {
      ops.unshift({ type: 'removed', content: a[i-1] }); i--
    }
  }
  return ops
}

// ── Build hunks (±CONTEXT lines around changes, like git diff) ────────────────

const CONTEXT = 3

function buildDiffLines(before: string, after: string): DiffLine[] {
  const ops = computeOps(before, after)

  // Assign line numbers
  type Numbered = { type: 'unchanged' | 'removed' | 'added'; content: string; oldNo: number | null; newNo: number | null }
  const numbered: Numbered[] = []
  let oldLine = 1, newLine = 1
  for (const op of ops) {
    if (op.type === 'unchanged') {
      numbered.push({ ...op, oldNo: oldLine++, newNo: newLine++ })
    } else if (op.type === 'removed') {
      numbered.push({ ...op, oldNo: oldLine++, newNo: null })
    } else {
      numbered.push({ ...op, oldNo: null, newNo: newLine++ })
    }
  }

  // Find changed line indices
  const changedIdx = numbered
    .map((l, i) => (l.type !== 'unchanged' ? i : -1))
    .filter(i => i >= 0)

  if (changedIdx.length === 0) {
    // No changes — show full file
    return numbered.map(l => l as DiffLine)
  }

  // Build hunk ranges [start, end] (inclusive), merging overlapping windows
  const ranges: [number, number][] = []
  for (const ci of changedIdx) {
    const s = Math.max(0, ci - CONTEXT)
    const e = Math.min(numbered.length - 1, ci + CONTEXT)
    if (ranges.length > 0 && s <= ranges[ranges.length - 1][1] + 1) {
      ranges[ranges.length - 1][1] = Math.max(ranges[ranges.length - 1][1], e)
    } else {
      ranges.push([s, e])
    }
  }

  // Flatten to DiffLine[] with @@ separators
  const result: DiffLine[] = []
  for (const [s, e] of ranges) {
    const first = numbered[s]
    const last  = numbered[e]
    const oldStart = first.oldNo ?? (first.newNo ?? 1)
    const newStart = first.newNo ?? (first.oldNo ?? 1)
    const oldLen   = numbered.slice(s, e + 1).filter(l => l.oldNo != null).length
    const newLen   = numbered.slice(s, e + 1).filter(l => l.newNo != null).length
    result.push({ type: 'hunk', label: `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@` })
    for (let k = s; k <= e; k++) {
      result.push(numbered[k] as DiffLine)
    }
  }
  return result
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function diffStats(lines: DiffLine[]) {
  let added = 0, removed = 0
  for (const l of lines) {
    if (l.type === 'added')   added++
    if (l.type === 'removed') removed++
  }
  return { added, removed }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DiffViewer({ payload, onApprove, onAcceptAll, onReject }: Props) {
  const [showFull, setShowFull] = useState(false)

  const hunkLines = useMemo(
    () => buildDiffLines(payload.before, payload.after),
    [payload.before, payload.after]
  )
  const fullLines = useMemo(
    () => buildDiffLines(payload.before, payload.after).filter(l => l.type !== 'hunk'),
    [payload.before, payload.after]
  )

  const lines = showFull ? fullLines : hunkLines
  const { added, removed } = diffStats(hunkLines)
  const hasHunks = hunkLines.some(l => l.type === 'hunk')

  // File extension for a subtle language hint in header
  const ext = payload.path.split('.').pop()?.toUpperCase() ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-4xl sm:max-h-[92vh] max-h-[85vh] flex flex-col bg-white dark:bg-gray-900 sm:rounded-2xl rounded-t-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/80">
          <div className="flex items-start gap-3 min-w-0">
            {/* Icon */}
            <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base
              ${payload.isNew ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}`}>
              {payload.isNew ? '✨' : '✏️'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                  {payload.isNew ? 'Create file' : 'Edit file'}
                </h2>
                {ext && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {ext}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate max-w-[380px] mt-0.5">
                {payload.path}
              </p>
              {/* Stats */}
              <div className="flex items-center gap-3 mt-1 text-xs">
                {payload.isNew ? (
                  <span className="text-green-600 dark:text-green-400 font-medium">New · {added} lines</span>
                ) : (
                  <>
                    {added   > 0 && <span className="text-green-600 dark:text-green-400 font-medium">+{added} added</span>}
                    {removed > 0 && <span className="text-red-500 dark:text-red-400 font-medium">−{removed} removed</span>}
                    {added === 0 && removed === 0 && <span className="text-gray-400">No changes</span>}
                  </>
                )}
                {hasHunks && !payload.isNew && (
                  <button
                    onClick={() => setShowFull(v => !v)}
                    className="text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2 text-[11px]"
                  >
                    {showFull ? 'Show diff' : 'Show full file'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Action buttons ── */}
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <button
              onClick={onReject}
              title="Reject this edit (Esc)"
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                         bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/20
                         text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400
                         border border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-700"
            >
              Reject
            </button>
            <button
              onClick={onAcceptAll}
              title="Approve this and all future edits in this session"
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                         bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50
                         text-blue-700 dark:text-blue-300
                         border border-blue-200 dark:border-blue-700"
            >
              Accept All
            </button>
            <button
              onClick={onApprove}
              title="Approve this edit (Enter)"
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                         bg-green-600 hover:bg-green-500 active:bg-green-700
                         text-white shadow-sm"
            >
              ✓ Approve
            </button>
          </div>
        </div>

        {/* ── Diff body ── */}
        <div className="flex-1 overflow-auto font-mono text-xs leading-5 bg-white dark:bg-gray-950">
          {lines.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              No changes
            </div>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, idx) => {
                  if (line.type === 'hunk') {
                    return (
                      <tr key={idx} className="bg-blue-50/60 dark:bg-blue-900/10">
                        <td colSpan={3} className="px-4 py-1 text-blue-400 dark:text-blue-600 text-[11px] font-mono select-none">
                          {line.label}
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr
                      key={idx}
                      className={
                        line.type === 'added'   ? 'bg-green-50  dark:bg-green-900/20' :
                        line.type === 'removed' ? 'bg-red-50    dark:bg-red-900/20'   :
                        'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                      }
                    >
                      {/* Old line number */}
                      <td className={`select-none text-right pr-2 pl-3 py-px w-10 text-[10px] tabular-nums
                        ${line.type === 'removed' ? 'text-red-400 dark:text-red-700' : 'text-gray-300 dark:text-gray-700'}`}>
                        {'oldNo' in line && line.oldNo != null ? line.oldNo : ''}
                      </td>
                      {/* New line number */}
                      <td className={`select-none text-right pr-2 py-px w-10 border-r text-[10px] tabular-nums
                        ${line.type === 'added' ? 'text-green-500 dark:text-green-700 border-green-200 dark:border-green-800' :
                          line.type === 'removed' ? 'border-red-200 dark:border-red-800 text-transparent' :
                          'border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-700'}`}>
                        {'newNo' in line && line.newNo != null ? line.newNo : ''}
                      </td>
                      {/* Gutter sign */}
                      <td className={`select-none text-center w-5 py-px text-xs font-bold
                        ${line.type === 'added'   ? 'text-green-500 dark:text-green-400' :
                          line.type === 'removed' ? 'text-red-500 dark:text-red-400'     :
                          'text-transparent'}`}>
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
                      </td>
                      {/* Content */}
                      <td className={`py-px pl-1 pr-4 whitespace-pre overflow-hidden text-ellipsis
                        ${line.type === 'added'   ? 'text-green-800 dark:text-green-300' :
                          line.type === 'removed' ? 'text-red-800 dark:text-red-300'     :
                          'text-gray-700 dark:text-gray-400'}`}>
                        {line.content || ' '}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-4 py-2.5 border-t border-gray-200 dark:border-gray-800 flex-shrink-0 flex items-center justify-between bg-gray-50 dark:bg-gray-900/60">
          <p className="text-[11px] text-gray-400 dark:text-gray-600">
            <span className="font-semibold text-gray-500 dark:text-gray-500">Accept All</span> approves this and all remaining file writes without prompting.
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-600">
            <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 font-mono text-[10px]">Enter</kbd>
            <span>Approve</span>
            <span className="mx-1 opacity-40">·</span>
            <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 font-mono text-[10px]">Esc</kbd>
            <span>Reject</span>
          </div>
        </div>
      </div>
    </div>
  )
}
