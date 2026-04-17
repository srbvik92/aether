/**
 * Scheduled Tasks panel — create and manage AI tasks that run on a schedule.
 * Each task fires its prompt at the configured cron time and sends it to the AI.
 */

import { useState, useEffect, useCallback } from 'react'
import { AppSettings } from '../../../shared/types'

const isElectron = typeof window !== 'undefined' && !!window.api

// ── Local type (may not be in shared/types yet) ──────────────────────────────

interface ScheduledTask {
  id:        string
  name:      string
  prompt:    string
  schedule:  string
  enabled:   boolean
  createdAt: number
  lastRun?:  number
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  settings: AppSettings
  onClose:  () => void
}

// ── Schedule presets ─────────────────────────────────────────────────────────

interface SchedulePreset {
  label:  string
  cron:   string
}

const PRESETS: SchedulePreset[] = [
  { label: 'Every day at 9am',    cron: '0 9 * * *'     },
  { label: 'Every Monday at 8am', cron: '0 8 * * 1'     },
  { label: 'Every hour',          cron: '0 * * * *'     },
  { label: 'Every 30 minutes',    cron: '*/30 * * * *'  },
]

const CUSTOM_VALUE = '__custom__'

/** Return a human-readable label for a cron string, or the cron itself. */
function cronLabel(cron: string): string {
  const match = PRESETS.find(p => p.cron === cron)
  return match ? match.label : cron
}

// ── Relative-time helper ─────────────────────────────────────────────────────

function relativeTime(ts: number | undefined): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  const sec  = Math.floor(diff / 1000)
  if (sec < 60)   return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60)   return `${min} minute${min !== 1 ? 's' : ''} ago`
  const hr  = Math.floor(min / 60)
  if (hr  < 24)   return `${hr} hour${hr !== 1 ? 's' : ''} ago`
  const day = Math.floor(hr / 24)
  if (day < 30)   return `${day} day${day !== 1 ? 's' : ''} ago`
  const mo  = Math.floor(day / 30)
  if (mo  < 12)   return `${mo} month${mo !== 1 ? 's' : ''} ago`
  const yr  = Math.floor(mo / 12)
  return `${yr} year${yr !== 1 ? 's' : ''} ago`
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScheduledTasksPanel({ settings: _settings, onClose }: Props) {
  // ── list state ────────────────────────────────────────────────────────────
  const [tasks,   setTasks]   = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [listErr, setListErr] = useState<string | null>(null)

  // ── per-task action loading (taskId → action) ─────────────────────────────
  const [busyMap, setBusyMap] = useState<Record<string, 'run' | 'delete'>>({})

  // ── add-form state ────────────────────────────────────────────────────────
  const [formName,     setFormName]     = useState('')
  const [formPrompt,   setFormPrompt]   = useState('')
  const [formPreset,   setFormPreset]   = useState<string>(PRESETS[0].cron)
  const [formCustom,   setFormCustom]   = useState('')
  const [formSaving,   setFormSaving]   = useState(false)
  const [formErr,      setFormErr]      = useState<string | null>(null)
  const [formSuccess,  setFormSuccess]  = useState(false)

  // Derived: the actual cron string for the form
  const formCron = formPreset === CUSTOM_VALUE ? formCustom.trim() : formPreset

  // ── Load tasks ─────────────────────────────────────────────────────────────
  const loadTasks = useCallback(async () => {
    if (!isElectron) { setLoading(false); return }
    setListErr(null)
    try {
      const list = await window.api.listScheduledTasks()
      setTasks(list)
    } catch (e) {
      setListErr((e as Error).message ?? 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // ── Escape to close ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRunNow = useCallback(async (id: string) => {
    if (!isElectron) return
    setBusyMap(m => ({ ...m, [id]: 'run' }))
    try {
      await window.api.runScheduledTask(id)
      await loadTasks()
    } finally {
      setBusyMap(m => { const next = { ...m }; delete next[id]; return next })
    }
  }, [loadTasks])

  const handleDelete = useCallback(async (id: string) => {
    if (!isElectron) return
    setBusyMap(m => ({ ...m, [id]: 'delete' }))
    try {
      await window.api.deleteScheduledTask(id)
      setTasks(prev => prev.filter(t => t.id !== id))
    } finally {
      setBusyMap(m => { const next = { ...m }; delete next[id]; return next })
    }
  }, [])

  // ── Add-form submit ────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!isElectron) return
    setFormErr(null)

    const name   = formName.trim()
    const prompt = formPrompt.trim()
    const cron   = formCron

    if (!name)   { setFormErr('Name is required');   return }
    if (!prompt) { setFormErr('Prompt is required');  return }
    if (!cron)   { setFormErr('Schedule is required'); return }

    setFormSaving(true)
    try {
      const result = await window.api.createScheduledTask({
        name,
        prompt,
        schedule: cron,
        enabled:  true,
      })
      if (!result.ok) {
        setFormErr(result.error ?? 'Failed to create task')
        return
      }
      // Reset form
      setFormName('')
      setFormPrompt('')
      setFormPreset(PRESETS[0].cron)
      setFormCustom('')
      setFormSuccess(true)
      setTimeout(() => setFormSuccess(false), 2000)
      await loadTasks()
    } catch (e) {
      setFormErr((e as Error).message ?? 'Failed to create task')
    } finally {
      setFormSaving(false)
    }
  }, [formName, formPrompt, formCron, loadTasks])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[580px] max-w-[94vw] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[85vh]">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="text-xl leading-none">🕐</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Scheduled Tasks</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Prompts that run automatically on a schedule
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Task list ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 text-sm gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Loading…
            </div>
          ) : listErr ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-2">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-500">{listErr}</p>
              <button
                onClick={loadTasks}
                className="text-xs text-blue-500 hover:underline"
              >
                Retry
              </button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <span className="text-3xl mb-2">🕐</span>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No tasks yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-600 mt-1 max-w-xs">
                Create a scheduled task below and the AI will automatically run your prompt at the chosen time.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {tasks.map(task => {
                const busy = busyMap[task.id]
                return (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 px-5 py-4 group hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                  >
                    {/* Enabled indicator dot */}
                    <div className="flex-shrink-0 mt-1">
                      <span
                        className={`block w-2 h-2 rounded-full mt-0.5 ${
                          task.enabled
                            ? 'bg-green-400'
                            : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                        title={task.enabled ? 'Enabled' : 'Disabled'}
                      />
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{task.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-blue-600 dark:text-blue-400 font-mono bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                          {task.schedule}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {cronLabel(task.schedule)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 line-clamp-2 leading-snug">
                        {task.prompt}
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-1">
                        Last run: {relativeTime(task.lastRun)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                      {/* Run now */}
                      <button
                        onClick={() => handleRunNow(task.id)}
                        disabled={!!busy}
                        title="Run now"
                        className="w-7 h-7 rounded-lg flex items-center justify-center
                                   text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30
                                   disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        {busy === 'run' ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(task.id)}
                        disabled={!!busy}
                        title="Delete task"
                        className="w-7 h-7 rounded-lg flex items-center justify-center
                                   text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30
                                   disabled:opacity-40 disabled:cursor-not-allowed transition-all
                                   opacity-0 group-hover:opacity-100"
                      >
                        {busy === 'delete' ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Add form ── */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50 space-y-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">New task</p>

          {/* Name */}
          <div>
            <input
              type="text"
              value={formName}
              onChange={e => { setFormName(e.target.value); setFormErr(null) }}
              placeholder="Task name  e.g. Morning standup summary"
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                         text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600
                         outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Prompt */}
          <div>
            <textarea
              value={formPrompt}
              onChange={e => { setFormPrompt(e.target.value); setFormErr(null) }}
              placeholder="Prompt to send to the AI at the scheduled time…"
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                         text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600
                         outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         resize-none transition-all"
            />
          </div>

          {/* Schedule picker row */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <select
                value={formPreset}
                onChange={e => { setFormPreset(e.target.value); setFormErr(null) }}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                           text-sm text-gray-700 dark:text-gray-300
                           outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all
                           appearance-none cursor-pointer"
              >
                {PRESETS.map(p => (
                  <option key={p.cron} value={p.cron}>
                    {p.label}  ({p.cron})
                  </option>
                ))}
                <option value={CUSTOM_VALUE}>Custom cron…</option>
              </select>
            </div>

            {formPreset === CUSTOM_VALUE && (
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={formCustom}
                  onChange={e => { setFormCustom(e.target.value); setFormErr(null) }}
                  placeholder="e.g. 0 17 * * 5"
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                             text-sm font-mono text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600
                             outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
            )}
          </div>

          {/* Cron preview label */}
          {formCron && formPreset !== CUSTOM_VALUE && (
            <p className="text-[11px] text-gray-400 dark:text-gray-600 -mt-1">
              Schedule: <span className="font-mono text-blue-500">{formCron}</span>
              {' · '}
              <span>{cronLabel(formCron)}</span>
            </p>
          )}

          {/* Error / success messages */}
          {formErr && (
            <p className="text-xs text-red-500">{formErr}</p>
          )}
          {formSuccess && !formErr && (
            <p className="text-xs text-green-500 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Task created
            </p>
          )}

          {/* Save button */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={formSaving || !formName.trim() || !formPrompt.trim() || !formCron}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              {formSaving ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Saving…
                </>
              ) : (
                'Save task'
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
