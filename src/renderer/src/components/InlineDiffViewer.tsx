/**
 * InlineDiffViewer — shows a per-hunk accept/reject diff directly inside
 * a ToolCallCard when the AI wants to write or edit a file.
 *
 * Each "hunk" (contiguous block of changes) can be independently accepted
 * or rejected. The final content written to disk is computed by merging
 * accepted hunks with the original content for rejected ones.
 */

import { useState, useMemo } from 'react'
import { DiffRequestPayload } from '../../../shared/types'

// ── Types ──────────────────────────────────────────────────────────────────────

type Op = { type: 'unchanged' | 'removed' | 'added'; content: string }

interface NumberedOp extends Op {
  oldNo: number | null
  newNo: number | null
  hunkId: number | null   // null = context line (not part of any change group)
}

interface Hunk {
  id:    number
  label: string        // @@ header
  lines: NumberedOp[]  // display lines (includes ±3 context lines)
  ops:   NumberedOp[]  // only the actual change ops (removed/added) in this hunk
}

// ── LCS diff ──────────────────────────────────────────────────────────────────

function computeOps(before: string, after: string): Op[] {
  const a = before ? before.split('\n') : []
  const b = after  ? after.split('\n')  : []
  if (before === after) return a.map(c => ({ type: 'unchanged' as const, content: c }))
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

// ── Build numbered ops with hunk assignment ────────────────────────────────────

function buildNumberedOps(before: string, after: string): NumberedOp[] {
  const ops = computeOps(before, after)
  const numbered: NumberedOp[] = []
  let oldLine = 1, newLine = 1, hunkId = 0, inHunk = false
  for (const op of ops) {
    if (op.type === 'unchanged') {
      numbered.push({ ...op, oldNo: oldLine++, newNo: newLine++, hunkId: null })
      inHunk = false
    } else if (op.type === 'removed') {
      if (!inHunk) { hunkId++; inHunk = true }
      numbered.push({ ...op, oldNo: oldLine++, newNo: null, hunkId })
    } else {
      if (!inHunk) { hunkId++; inHunk = true }
      numbered.push({ ...op, oldNo: null, newNo: newLine++, hunkId })
    }
  }
  return numbered
}

// ── Group into display hunks (±3 context lines around each change group) ────────

const CONTEXT = 3

function buildHunks(numbered: NumberedOp[]): Hunk[] {
  const changeIdx = numbered
    .map((op, i) => (op.hunkId !== null ? i : -1))
    .filter(i => i >= 0)
  if (changeIdx.length === 0) return []

  // Merge overlapping ±CONTEXT windows into display ranges
  const ranges: [number, number][] = []
  for (const ci of changeIdx) {
    const s = Math.max(0, ci - CONTEXT)
    const e = Math.min(numbered.length - 1, ci + CONTEXT)
    if (ranges.length > 0 && s <= ranges[ranges.length - 1][1] + 1) {
      ranges[ranges.length - 1][1] = Math.max(ranges[ranges.length - 1][1], e)
    } else {
      ranges.push([s, e])
    }
  }

  const hunks: Hunk[] = []
  const seenHunkIds = new Set<number>()
  let displayHunkCounter = 0

  for (const [s, e] of ranges) {
    const rangeOps = numbered.slice(s, e + 1)
    const hunkIds = [...new Set(rangeOps.filter(op => op.hunkId !== null).map(op => op.hunkId!))]
    const newHunkIds = hunkIds.filter(id => !seenHunkIds.has(id))
    if (newHunkIds.length === 0) continue
    newHunkIds.forEach(id => seenHunkIds.add(id))

    displayHunkCounter++

    const first = rangeOps[0]
    const oldStart = first.oldNo ?? first.newNo ?? 1
    const newStart = first.newNo ?? first.oldNo ?? 1
    const oldLen = rangeOps.filter(l => l.oldNo != null).length
    const newLen = rangeOps.filter(l => l.newNo != null).length
    const label = `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`

    const changeOps = rangeOps.filter(op => op.hunkId !== null && newHunkIds.includes(op.hunkId!))

    hunks.push({ id: displayHunkCounter, label, lines: rangeOps, ops: changeOps })
  }

  return hunks
}

// ── Apply selected hunks to produce result content ─────────────────────────────

function applySelectedHunks(numbered: NumberedOp[], acceptedHunkIds: Set<number>): string {
  const result: string[] = []
  for (const op of numbered) {
    if (op.type === 'unchanged') {
      result.push(op.content)
    } else if (op.type === 'removed') {
      if (op.hunkId === null || !acceptedHunkIds.has(op.hunkId)) {
        result.push(op.content)  // rejected: keep original line
      }
      // accepted: don't include (line is removed)
    } else { // added
      if (op.hunkId !== null && acceptedHunkIds.has(op.hunkId)) {
        result.push(op.content)  // accepted: include new line
      }
      // rejected: don't include
    }
  }
  return result.join('\n')
}

// ── Stats helpers ──────────────────────────────────────────────────────────────

function hunkStats(hunk: Hunk) {
  let added = 0, removed = 0
  for (const op of hunk.ops) {
    if (op.type === 'added')   added++
    if (op.type === 'removed') removed++
  }
  return { added, removed }
}

function totalStats(hunks: Hunk[]) {
  let added = 0, removed = 0
  for (const h of hunks) {
    const s = hunkStats(h)
    added   += s.added
    removed += s.removed
  }
  return { added, removed }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  payload:   DiffRequestPayload
  diffId:    string
  onApprove: (content: string) => void   // called with computed content
  onReject:  () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InlineDiffViewer({ payload, onApprove, onReject }: Props) {
  const numbered = useMemo(() => buildNumberedOps(payload.before, payload.after), [payload.before, payload.after])
  const hunks    = useMemo(() => buildHunks(numbered), [numbered])

  const allLogicalIds = useMemo(() => {
    const ids = new Set<number>()
    numbered.forEach(op => { if (op.hunkId !== null) ids.add(op.hunkId) })
    return ids
  }, [numbered])

  const [acceptedHunkIds, setAcceptedHunkIds] = useState<Set<number>>(() => new Set(allLogicalIds))
  const [showFull, setShowFull] = useState(false)

  const toggleHunk = (hunk: Hunk) => {
    const logicalIds = new Set(hunk.ops.filter(op => op.hunkId !== null).map(op => op.hunkId!))
    const allAccepted = [...logicalIds].every(id => acceptedHunkIds.has(id))
    setAcceptedHunkIds(prev => {
      const next = new Set(prev)
      if (allAccepted) {
        logicalIds.forEach(id => next.delete(id))
      } else {
        logicalIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  const acceptAll = () => setAcceptedHunkIds(new Set(allLogicalIds))
  const rejectAll = () => setAcceptedHunkIds(new Set())

  const handleApply = () => {
    const content = applySelectedHunks(numbered, acceptedHunkIds)
    onApprove(content)
  }

  const { added, removed } = totalStats(hunks)
  const ext = payload.path.split('.').pop()?.toUpperCase() ?? ''
  const hasChanges = hunks.length > 0
  const acceptedCount = hunks.filter(h => {
    const ids = new Set(h.ops.filter(op => op.hunkId !== null).map(op => op.hunkId!))
    return [...ids].every(id => acceptedHunkIds.has(id))
  }).length
  const fileName = payload.path.split(/[\\/]/).pop() ?? payload.path

  return (
    <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
        <span className="text-sm">{payload.isNew ? '✨' : '✏️'}</span>
        <span className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate block">{fileName}</span>
          <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 truncate block">{payload.path}</span>
        </span>
        <div className="flex items-center gap-1.5 text-[11px] flex-shrink-0">
          {ext && <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{ext}</span>}
          {payload.isNew ? (
            <span className="text-green-600 dark:text-green-400 font-medium">+{added} new</span>
          ) : (
            <>
              {added   > 0 && <span className="text-green-600 dark:text-green-400 font-medium">+{added}</span>}
              {removed > 0 && <span className="text-red-500 dark:text-red-400 font-medium">−{removed}</span>}
            </>
          )}
          {hasChanges && !payload.isNew && (
            <button
              onClick={() => setShowFull(v => !v)}
              className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 underline underline-offset-2"
            >
              {showFull ? 'diff' : 'full'}
            </button>
          )}
        </div>
      </div>

      {/* Hunk selection bar (only when multiple hunks) */}
      {hunks.length > 1 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50/50 dark:bg-blue-900/10 border-b border-gray-200 dark:border-gray-700 text-[11px]">
          <span className="text-gray-500 dark:text-gray-400">{acceptedCount}/{hunks.length} hunks selected</span>
          <button onClick={acceptAll} className="text-green-600 dark:text-green-400 hover:underline">Accept all</button>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <button onClick={rejectAll} className="text-red-500 dark:text-red-400 hover:underline">Reject all</button>
        </div>
      )}

      {/* Diff body */}
      <div className="font-mono text-xs leading-5 bg-white dark:bg-gray-950 max-h-80 overflow-y-auto">
        {!hasChanges ? (
          <div className="flex items-center justify-center h-12 text-gray-400 text-xs italic">No changes</div>
        ) : showFull ? (
          // Full file view (no hunk controls)
          <table className="w-full border-collapse">
            <tbody>
              {numbered.map((op, idx) => (
                <tr key={idx} className={
                  op.type === 'added'   ? 'bg-green-50  dark:bg-green-900/20' :
                  op.type === 'removed' ? 'bg-red-50    dark:bg-red-900/20'   :
                  'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                }>
                  <td className={`select-none text-right pr-2 pl-3 py-px w-10 text-[10px] tabular-nums ${op.type === 'removed' ? 'text-red-400 dark:text-red-700' : 'text-gray-300 dark:text-gray-700'}`}>
                    {op.oldNo ?? ''}
                  </td>
                  <td className={`select-none text-right pr-2 py-px w-10 border-r text-[10px] tabular-nums ${op.type === 'added' ? 'text-green-500 dark:text-green-700 border-green-200 dark:border-green-800' : op.type === 'removed' ? 'border-red-200 dark:border-red-800 text-transparent' : 'border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-700'}`}>
                    {op.newNo ?? ''}
                  </td>
                  <td className={`select-none text-center w-5 py-px text-xs font-bold ${op.type === 'added' ? 'text-green-500 dark:text-green-400' : op.type === 'removed' ? 'text-red-500 dark:text-red-400' : 'text-transparent'}`}>
                    {op.type === 'added' ? '+' : op.type === 'removed' ? '−' : ' '}
                  </td>
                  <td className={`py-px pl-1 pr-4 whitespace-pre overflow-hidden text-ellipsis ${op.type === 'added' ? 'text-green-800 dark:text-green-300' : op.type === 'removed' ? 'text-red-800 dark:text-red-300' : 'text-gray-700 dark:text-gray-400'}`}>
                    {op.content || ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // Hunk view with per-hunk accept/reject
          <div>
            {hunks.map(hunk => {
              const logicalIds = new Set(hunk.ops.filter(op => op.hunkId !== null).map(op => op.hunkId!))
              const isAccepted = [...logicalIds].every(id => acceptedHunkIds.has(id))
              const { added: hAdded, removed: hRemoved } = hunkStats(hunk)

              return (
                <div key={hunk.id} className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${!isAccepted ? 'opacity-50' : ''}`}>
                  {/* Hunk header with accept/reject toggle */}
                  <div className="flex items-center gap-2 px-2 py-1 bg-blue-50/60 dark:bg-blue-900/10 text-[10px]">
                    <span className="flex-1 font-mono text-blue-400 dark:text-blue-600 truncate">{hunk.label}</span>
                    <span className="text-green-600 dark:text-green-500">+{hAdded}</span>
                    <span className="text-red-500 dark:text-red-400">−{hRemoved}</span>
                    <button
                      onClick={() => toggleHunk(hunk)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors ${
                        isAccepted
                          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 hover:bg-green-100 dark:hover:bg-green-900/40 hover:text-green-600 dark:hover:text-green-300'
                      }`}
                    >
                      {isAccepted ? (
                        <><svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg> Accept</>
                      ) : (
                        <><svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> Skip</>
                      )}
                    </button>
                  </div>

                  {/* Diff lines */}
                  <table className="w-full border-collapse">
                    <tbody>
                      {hunk.lines.map((op, lineIdx) => (
                        <tr key={lineIdx} className={
                          op.type === 'added'   ? 'bg-green-50  dark:bg-green-900/20' :
                          op.type === 'removed' ? 'bg-red-50    dark:bg-red-900/20'   :
                          'hover:bg-gray-50 dark:hover:bg-gray-800/30'
                        }>
                          <td className={`select-none text-right pr-2 pl-3 py-px w-10 text-[10px] tabular-nums ${op.type === 'removed' ? 'text-red-400 dark:text-red-700' : 'text-gray-300 dark:text-gray-700'}`}>
                            {op.oldNo ?? ''}
                          </td>
                          <td className={`select-none text-right pr-2 py-px w-10 border-r text-[10px] tabular-nums ${op.type === 'added' ? 'text-green-500 dark:text-green-700 border-green-200 dark:border-green-800' : op.type === 'removed' ? 'border-red-200 dark:border-red-800 text-transparent' : 'border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-700'}`}>
                            {op.newNo ?? ''}
                          </td>
                          <td className={`select-none text-center w-5 py-px text-xs font-bold ${op.type === 'added' ? 'text-green-500 dark:text-green-400' : op.type === 'removed' ? 'text-red-500 dark:text-red-400' : 'text-transparent'}`}>
                            {op.type === 'added' ? '+' : op.type === 'removed' ? '−' : ' '}
                          </td>
                          <td className={`py-px pl-1 pr-4 whitespace-pre overflow-hidden text-ellipsis ${op.type === 'added' ? 'text-green-800 dark:text-green-300' : op.type === 'removed' ? 'text-red-800 dark:text-red-300' : 'text-gray-700 dark:text-gray-400'}`}>
                            {op.content || ' '}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={onReject}
          className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors
                     bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/20
                     text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400
                     border-gray-200 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-700"
        >
          Reject all
        </button>
        <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-1 text-center">
          {hunks.length > 1 ? `${acceptedCount}/${hunks.length} hunks` : 'Ctrl+Enter to apply'}
        </span>
        <button
          onClick={handleApply}
          disabled={acceptedCount === 0 && hunks.length > 0}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
            acceptedCount > 0 || hunks.length === 0
              ? 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
          }`}
        >
          {acceptedCount === hunks.length || hunks.length <= 1
            ? '✓ Apply'
            : `✓ Apply ${acceptedCount} hunk${acceptedCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
