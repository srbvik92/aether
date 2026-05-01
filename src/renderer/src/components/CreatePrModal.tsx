import { useState } from 'react'
import { CreatePrPayload } from '../../../shared/types'

interface Props {
  workspacePath: string
  defaultTitle:  string
  defaultBody:   string
  onClose:       () => void
  onCreated:     (url: string) => void
}

export default function CreatePrModal({ workspacePath, defaultTitle, defaultBody, onClose, onCreated }: Props) {
  const [title,   setTitle]   = useState(defaultTitle)
  const [body,    setBody]    = useState(defaultBody)
  const [draft,   setDraft]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) return
    setLoading(true)
    setError(null)
    try {
      const payload: CreatePrPayload = { title: title.trim(), body: body.trim(), workspacePath, draft }
      const result = await window.api.createPr(payload)
      if (result.ok) {
        onCreated(result.url ?? '')
      } else {
        setError(result.error ?? 'Failed to create PR')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-purple-500" fill="currentColor" viewBox="0 0 16 16">
              <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
            </svg>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Create Pull Request</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="PR title…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none font-mono"
              placeholder="Describe the changes…"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} className="rounded" />
            <span className="text-xs text-gray-600 dark:text-gray-400">Create as draft PR</span>
          </label>
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !title.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white transition-colors flex items-center gap-2"
          >
            {loading && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {loading ? 'Creating…' : 'Create PR'}
          </button>
        </div>
      </div>
    </div>
  )
}
