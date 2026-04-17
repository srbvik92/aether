/**
 * Prompt Library modal — save, manage, and run reusable prompts.
 *
 * Supports {{variable}} placeholders. When a prompt with variables is used,
 * a second step asks the user to fill in each variable before inserting.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { SavedPrompt } from '../../../shared/types'

const isElectron = typeof window !== 'undefined' && !!window.api

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/** Extract {{variable}} names from a prompt template */
function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{([^}]+)\}\}/g) ?? []
  const names = matches.map(m => m.slice(2, -2).trim())
  return [...new Set(names)]
}

/** Substitute {{variable}} occurrences in a template */
function applyVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (_, name) => values[name.trim()] ?? `{{${name}}}`)
}

// ── Empty state ───────────────────────────────────────────────────────────────
const EXAMPLE_PROMPTS: Omit<SavedPrompt, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Write tests for file',
    content: 'Write comprehensive unit tests for `{{filename}}`. Cover happy paths, edge cases, and error conditions. Use the existing test patterns in this codebase.',
    tags: ['testing']
  },
  {
    name: 'Code review',
    content: 'Review the changes in `{{filename}}`. Look for bugs, security issues, performance problems, and style inconsistencies. Be specific about line numbers.',
    tags: ['review']
  },
  {
    name: 'Explain this code',
    content: 'Read `{{filename}}` and explain how it works. Describe the purpose, the data flow, any non-obvious decisions, and how it fits into the broader codebase.',
    tags: ['docs']
  },
  {
    name: 'Fix failing tests',
    content: 'Run the test suite and fix all failing tests. Do not change the test expectations unless the test itself is wrong — fix the implementation instead.',
    tags: ['testing', 'debugging']
  },
  {
    name: 'Refactor for readability',
    content: 'Refactor `{{filename}}` for readability and maintainability. Keep the same public API and behavior. Add comments where the intent is non-obvious.',
    tags: ['refactor']
  }
]

// ── Variable fill-in dialog ───────────────────────────────────────────────────
interface VarDialogProps {
  prompt:    SavedPrompt
  variables: string[]
  onConfirm: (values: Record<string, string>) => void
  onCancel:  () => void
}

function VariableDialog({ prompt, variables, onConfirm, onCancel }: VarDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map(v => [v, '']))
  )
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => firstRef.current?.focus(), 50) }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const allFilled = variables.every(v => values[v]?.trim())

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (allFilled) onConfirm(values)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[480px] max-w-[92vw] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fill in variables</h3>
          <p className="text-xs text-gray-400 mt-0.5 truncate">"{prompt.name}"</p>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          {variables.map((v, i) => (
            <div key={v}>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                <code className="font-mono text-blue-500 dark:text-blue-400">{`{{${v}}}`}</code>
              </label>
              <input
                ref={i === 0 ? firstRef : undefined}
                type="text"
                value={values[v]}
                onChange={e => setValues(prev => ({ ...prev, [v]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && allFilled) { e.preventDefault(); onConfirm(values) } }}
                placeholder={`Value for ${v}…`}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                           bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                           placeholder-gray-400 dark:placeholder-gray-600 outline-none
                           focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={!allFilled}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                         disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              Use prompt
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700
                         hover:bg-gray-50 dark:hover:bg-gray-800 text-sm text-gray-600 dark:text-gray-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Prompt editor (create / edit) ─────────────────────────────────────────────
interface EditorProps {
  initial:  Partial<SavedPrompt>
  onSave:   (p: SavedPrompt) => void
  onCancel: () => void
}

function PromptEditor({ initial, onSave, onCancel }: EditorProps) {
  const [name,    setName]    = useState(initial.name    ?? '')
  const [content, setContent] = useState(initial.content ?? '')
  const [tags,    setTags]    = useState((initial.tags ?? []).join(', '))
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 50) }, [])

  const variables = extractVariables(content)
  const canSave   = name.trim() && content.trim()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    const now = Date.now()
    onSave({
      id:        initial.id ?? genId(),
      name:      name.trim(),
      content:   content.trim(),
      tags:      tags.split(',').map(t => t.trim()).filter(Boolean),
      createdAt: initial.createdAt ?? now,
      updatedAt: now
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {initial.id ? 'Edit prompt' : 'New prompt'}
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Write tests for file"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                       bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       placeholder-gray-400 dark:placeholder-gray-600 outline-none
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
        </div>

        {/* Content */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Prompt</label>
            <span className="text-[10px] text-gray-400 dark:text-gray-600">
              Use <code className="font-mono text-blue-400">{`{{variable}}`}</code> for placeholders
            </span>
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={`Write comprehensive unit tests for \`{{filename}}\`…`}
            rows={6}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                       bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       placeholder-gray-400 dark:placeholder-gray-600 outline-none resize-none
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
          />
          {variables.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {variables.map(v => (
                <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-mono border border-blue-200 dark:border-blue-700">
                  {`{{${v}}}`}
                </span>
              ))}
              <span className="text-[10px] text-gray-400 dark:text-gray-600 self-center ml-1">
                — will prompt for values when used
              </span>
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Tags <span className="font-normal text-gray-400">(comma-separated, optional)</span>
          </label>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="testing, review, docs…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                       bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       placeholder-gray-400 dark:placeholder-gray-600 outline-none
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
        </div>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
        <button
          type="submit"
          disabled={!canSave}
          className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                     disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          Save prompt
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700
                     hover:bg-gray-50 dark:hover:bg-gray-800 text-sm text-gray-600 dark:text-gray-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onUse:  (content: string) => void
  onClose: () => void
}

export default function PromptLibrary({ onUse, onClose }: Props) {
  const [prompts,      setPrompts]      = useState<SavedPrompt[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [editing,      setEditing]      = useState<Partial<SavedPrompt> | null>(null)  // null = list view
  const [varPrompt,    setVarPrompt]    = useState<SavedPrompt | null>(null)           // waiting for var values
  const [deleteId,     setDeleteId]     = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Load prompts ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) { setLoading(false); return }
    window.api.listPrompts().then(ps => {
      setPrompts(ps)
      setLoading(false)
      setTimeout(() => searchRef.current?.focus(), 50)
    })
  }, [])

  // Close on Escape (only when not in editor/var dialog)
  useEffect(() => {
    if (editing !== null || varPrompt) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, varPrompt, onClose])

  // ── Save / delete ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (prompt: SavedPrompt) => {
    if (!isElectron) return
    await window.api.savePrompt(prompt)
    setPrompts(prev => {
      const idx = prev.findIndex(p => p.id === prompt.id)
      if (idx >= 0) { const u = [...prev]; u[idx] = prompt; return u }
      return [prompt, ...prev]
    })
    setEditing(null)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!isElectron) return
    await window.api.deletePrompt(id)
    setPrompts(prev => prev.filter(p => p.id !== id))
    setDeleteId(null)
  }, [])

  // ── Use a prompt ─────────────────────────────────────────────────────────────
  const handleUse = useCallback((prompt: SavedPrompt) => {
    const vars = extractVariables(prompt.content)
    if (vars.length > 0) {
      setVarPrompt(prompt)
    } else {
      onUse(prompt.content)
      onClose()
    }
  }, [onUse, onClose])

  const handleVarConfirm = useCallback((values: Record<string, string>) => {
    if (!varPrompt) return
    const resolved = applyVariables(varPrompt.content, values)
    onUse(resolved)
    onClose()
  }, [varPrompt, onUse, onClose])

  // ── Add examples (first time empty state) ────────────────────────────────────
  const addExamples = useCallback(async () => {
    if (!isElectron) return
    const now = Date.now()
    const newPrompts: SavedPrompt[] = EXAMPLE_PROMPTS.map((p, i) => ({
      ...p,
      id:        genId(),
      createdAt: now + i,
      updatedAt: now + i
    }))
    for (const p of newPrompts) {
      await window.api.savePrompt(p)
    }
    setPrompts(newPrompts)
  }, [])

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filtered = search.trim()
    ? prompts.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.content.toLowerCase().includes(search.toLowerCase()) ||
        (p.tags ?? []).some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : prompts

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Variable fill-in dialog (above the main modal) */}
      {varPrompt && (
        <VariableDialog
          prompt={varPrompt}
          variables={extractVariables(varPrompt.content)}
          onConfirm={handleVarConfirm}
          onCancel={() => setVarPrompt(null)}
        />
      )}

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={e => { if (e.target === e.currentTarget && !editing && !varPrompt) onClose() }}
      >
        <div className="w-[640px] max-w-[92vw] h-[76vh] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

          {editing !== null ? (
            // ── Editor view ──────────────────────────────────────────────────
            <PromptEditor
              initial={editing}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
            />
          ) : (
            // ── List view ────────────────────────────────────────────────────
            <>
              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                <span className="text-xl leading-none">⚡</span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Prompt Library</h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Reusable prompts with <code className="font-mono text-blue-400">{`{{variable}}`}</code> placeholders
                  </p>
                </div>
                <button
                  onClick={() => setEditing({})}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  New prompt
                </button>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search prompts…"
                    className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {loading ? (
                  <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                    Loading…
                  </div>
                ) : prompts.length === 0 ? (
                  /* Empty state */
                  <div className="flex flex-col items-center justify-center h-full py-12 px-8 text-center">
                    <div className="text-4xl mb-3">⚡</div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">No prompts yet</p>
                    <p className="text-xs text-gray-400 dark:text-gray-600 mb-6 max-w-xs">
                      Save prompts you use often. Add <code className="font-mono text-blue-400">{`{{filename}}`}</code> anywhere to create a fillable variable.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditing({})}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                      >
                        Create first prompt
                      </button>
                      <button
                        onClick={addExamples}
                        className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700
                                   hover:bg-gray-50 dark:hover:bg-gray-800 text-sm text-gray-600 dark:text-gray-400 transition-colors"
                      >
                        Add examples
                      </button>
                    </div>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                    No prompts match "{search}"
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filtered.map(prompt => {
                      const vars = extractVariables(prompt.content)
                      const isDeleting = deleteId === prompt.id
                      return (
                        <div key={prompt.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 group transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{prompt.name}</p>
                              {vars.length > 0 && (
                                <div className="flex items-center gap-1">
                                  {vars.slice(0, 3).map(v => (
                                    <span key={v} className="text-[10px] px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-500 font-mono border border-blue-200 dark:border-blue-700">
                                      {`{{${v}}}`}
                                    </span>
                                  ))}
                                  {vars.length > 3 && (
                                    <span className="text-[10px] text-gray-400">+{vars.length - 3}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
                              {prompt.content}
                            </p>
                            {(prompt.tags?.length ?? 0) > 0 && (
                              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                {prompt.tags!.map(tag => (
                                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                            {isDeleting ? (
                              <>
                                <span className="text-xs text-red-500 mr-1">Delete?</span>
                                <button
                                  onClick={() => handleDelete(prompt.id)}
                                  className="px-2 py-1 rounded text-xs bg-red-500 hover:bg-red-400 text-white transition-colors"
                                >Yes</button>
                                <button
                                  onClick={() => setDeleteId(null)}
                                  className="px-2 py-1 rounded text-xs border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
                                >No</button>
                              </>
                            ) : (
                              <>
                                {/* Edit */}
                                <button
                                  onClick={() => setEditing(prompt)}
                                  className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center
                                             text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all"
                                  title="Edit"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round"
                                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                {/* Delete */}
                                <button
                                  onClick={() => setDeleteId(prompt.id)}
                                  className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center
                                             text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all"
                                  title="Delete"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                                {/* Use */}
                                <button
                                  onClick={() => handleUse(prompt)}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium
                                             transition-colors opacity-0 group-hover:opacity-100"
                                  title="Insert into chat input"
                                >
                                  Use
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-gray-50 dark:bg-gray-900/50">
                <p className="text-[11px] text-gray-400 dark:text-gray-600">
                  {prompts.length} prompt{prompts.length !== 1 ? 's' : ''} saved
                  {prompts.length > 0 && ' · Hover a row to edit, delete, or use it'}
                  {' · '}Use <kbd className="font-mono">Enter</kbd> to confirm variable values
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
