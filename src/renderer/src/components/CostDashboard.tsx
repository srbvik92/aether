import { useState, useEffect, useCallback } from 'react'
import { Conversation } from '../../../shared/types'
import {
  computeConversationCosts,
  groupByMonth,
  formatCost,
  formatTokens,
  ConversationCost,
  MonthlyCost
} from '../utils/tokenCost'

interface Props {
  onClose: () => void
}

type Tab = 'monthly' | 'conversations'

export default function CostDashboard({ onClose }: Props) {
  const [tab,           setTab]           = useState<Tab>('monthly')
  const [convCosts,     setConvCosts]     = useState<ConversationCost[]>([])
  const [monthlyCosts,  setMonthlyCosts]  = useState<MonthlyCost[]>([])
  const [loading,       setLoading]       = useState(true)
  const [sortBy,        setSortBy]        = useState<'date' | 'cost'>('date')

  const isElectron = typeof window !== 'undefined' && !!window.api

  useEffect(() => {
    if (!isElectron) { setLoading(false); return }
    window.api.listConversations().then((convs: Conversation[]) => {
      const costs = computeConversationCosts(convs)
      setConvCosts(costs)
      setMonthlyCosts(groupByMonth(costs))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const totalCost       = convCosts.reduce((sum, c) => sum + c.costUsd, 0)
  const thisMonthKey    = new Date().toISOString().slice(0, 7)
  const thisMonthCost   = monthlyCosts.find(m => m.month === thisMonthKey)?.costUsd ?? 0
  const totalInputTok   = convCosts.reduce((s, c) => s + c.inputTokens, 0)
  const totalOutputTok  = convCosts.reduce((s, c) => s + c.outputTokens, 0)

  const sortedConvs = [...convCosts].sort((a, b) =>
    sortBy === 'cost' ? b.costUsd - a.costUsd : b.date - a.date
  )

  // ── CSV Export ──────────────────────────────────────────────────────────────
  const exportCsv = useCallback(() => {
    const rows = [
      ['Date', 'Title', 'Provider', 'Model', 'Input Tokens', 'Output Tokens', 'Cost (USD)'],
      ...convCosts.map(c => [
        new Date(c.date).toISOString().slice(0, 10),
        `"${c.title.replace(/"/g, '""')}"`,
        c.provider,
        c.model,
        c.inputTokens.toString(),
        c.outputTokens.toString(),
        c.costUsd.toFixed(6)
      ])
    ]
    const csv  = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `chatui-costs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [convCosts])

  const tabCls = (t: Tab) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ` +
    (tab === t
      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[680px] max-w-[94vw] max-h-[85vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="text-xl leading-none">💰</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Usage & Cost</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Estimated from token counts — actual billing may vary slightly
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <>
            {/* ── Summary cards ──────────────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-3 px-5 py-4 flex-shrink-0 border-b border-gray-100 dark:border-gray-800">
              <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-4 py-3">
                <p className="text-[11px] text-blue-500 dark:text-blue-400 font-medium uppercase tracking-wide mb-1">This Month</p>
                <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCost(thisMonthCost)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-4 py-3">
                <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-1">All Time</p>
                <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{formatCost(totalCost)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{convCosts.length} conversations</p>
              </div>
              <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-4 py-3">
                <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-1">Total Tokens</p>
                <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{formatTokens(totalInputTok + totalOutputTok)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{formatTokens(totalInputTok)} in · {formatTokens(totalOutputTok)} out</p>
              </div>
            </div>

            {/* ── Tabs ───────────────────────────────────────────────────── */}
            <div className="flex items-center gap-1 px-5 py-2 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg">
                <button className={tabCls('monthly')} onClick={() => setTab('monthly')}>By Month</button>
                <button className={tabCls('conversations')} onClick={() => setTab('conversations')}>By Conversation</button>
              </div>
              {tab === 'conversations' && (
                <div className="ml-auto flex items-center gap-1 text-xs">
                  <span className="text-gray-400">Sort:</span>
                  <button
                    onClick={() => setSortBy('date')}
                    className={`px-2 py-1 rounded ${sortBy === 'date' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                  >Newest</button>
                  <button
                    onClick={() => setSortBy('cost')}
                    className={`px-2 py-1 rounded ${sortBy === 'cost' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                  >Highest cost</button>
                </div>
              )}
            </div>

            {/* ── Content ────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {tab === 'monthly' ? (
                monthlyCosts.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No data yet</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Month</th>
                        <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Conversations</th>
                        <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {monthlyCosts.map(m => (
                        <tr key={m.month} className={`hover:bg-gray-50 dark:hover:bg-gray-800/40 ${m.month === thisMonthKey ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
                          <td className="px-5 py-2.5 font-medium text-gray-700 dark:text-gray-300">
                            {new Date(m.month + '-01').toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}
                            {m.month === thisMonthKey && <span className="ml-2 text-[10px] text-blue-500 font-medium">current</span>}
                          </td>
                          <td className="px-5 py-2.5 text-right text-gray-500 dark:text-gray-400">{m.convCount}</td>
                          <td className="px-5 py-2.5 text-right font-mono font-medium text-gray-800 dark:text-gray-200">{formatCost(m.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                sortedConvs.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No conversations yet</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                      <tr>
                        <th className="text-left px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Conversation</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Model</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Tokens</th>
                        <th className="text-right px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {sortedConvs.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                          <td className="px-5 py-2.5 max-w-[240px]">
                            <p className="truncate text-gray-700 dark:text-gray-300 font-medium">{c.title}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{new Date(c.date).toLocaleDateString()}</p>
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-gray-400 dark:text-gray-500 font-mono whitespace-nowrap">{c.model}</td>
                          <td className="px-3 py-2.5 text-right text-xs text-gray-400">
                            <span title={`${c.inputTokens.toLocaleString()} in / ${c.outputTokens.toLocaleString()} out`}>
                              {formatTokens(c.inputTokens + c.outputTokens)}
                            </span>
                          </td>
                          <td className={`px-5 py-2.5 text-right font-mono font-medium ${c.costUsd === 0 ? 'text-gray-300 dark:text-gray-700' : 'text-gray-800 dark:text-gray-200'}`}>
                            {formatCost(c.costUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>

            {/* ── Footer ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
              <p className="text-[11px] text-gray-400">
                Token counts estimated · models without pricing shown as $0.00
              </p>
              <button
                onClick={exportCsv}
                disabled={convCosts.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                           bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                           text-gray-600 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500
                           hover:text-blue-600 dark:hover:text-blue-400 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export CSV
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
