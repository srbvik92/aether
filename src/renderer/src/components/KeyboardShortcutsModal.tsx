import { useEffect } from 'react'

interface Props {
  onClose: () => void
}

interface Shortcut {
  keys:        string[]
  description: string
}

interface ShortcutGroup {
  label:     string
  shortcuts: Shortcut[]
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const mod   = isMac ? '⌘' : 'Ctrl'

const GROUPS: ShortcutGroup[] = [
  {
    label: 'Navigation',
    shortcuts: [
      { keys: [mod, 'N'],           description: 'New chat' },
      { keys: [mod, '↑'],           description: 'Previous conversation' },
      { keys: [mod, '↓'],           description: 'Next conversation' },
      { keys: [mod, 'Shift', 'F'],  description: 'Search conversations' },
    ]
  },
  {
    label: 'Chat',
    shortcuts: [
      { keys: ['Enter'],            description: 'Send message' },
      { keys: ['Shift', 'Enter'],   description: 'New line in message' },
      { keys: [mod, '/'],           description: 'Focus input box' },
      { keys: ['Escape'],           description: 'Stop generation / close panel' },
    ]
  },
  {
    label: 'Interface',
    shortcuts: [
      { keys: [mod, ','],           description: 'Open settings' },
      { keys: [mod, '`'],           description: 'Toggle terminal panel' },
      { keys: [mod, '?'],           description: 'Show keyboard shortcuts (this)' },
    ]
  },
  {
    label: 'Code Blocks',
    shortcuts: [
      { keys: ['Click copy'],       description: 'Copy code to clipboard' },
      { keys: ['Click ▶'],          description: 'Run JS / Python in sandbox' },
    ]
  },
  {
    label: 'Messages',
    shortcuts: [
      { keys: ['Click ✏️'],         description: 'Edit a user message' },
      { keys: ['Click ↩'],          description: 'Regenerate AI response' },
      { keys: ['Click ⎇'],          description: 'Branch conversation from here' },
      { keys: ['Click 👍 / 👎'],    description: 'Rate AI response' },
    ]
  }
]

function KeyChip({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded
                   bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600
                   text-[11px] font-mono font-semibold text-gray-700 dark:text-gray-300
                   shadow-[0_1px_0] shadow-gray-300 dark:shadow-gray-700
                   leading-none min-w-[20px]">
      {k}
    </kbd>
  )
}

export default function KeyboardShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700
                      w-full max-w-xl mx-4 max-h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 10h18M3 14h18M10 3v18M14 3v18" />
            </svg>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          <div className="space-y-5">
            {GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600 mb-2">
                  {group.label}
                </p>
                <div className="space-y-1.5">
                  {group.shortcuts.map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 py-1">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{s.description}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {s.keys.map((k, ki) => (
                          <span key={ki} className="flex items-center gap-1">
                            {ki > 0 && <span className="text-gray-400 dark:text-gray-600 text-[10px] mx-0.5">+</span>}
                            <KeyChip k={k} />
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 flex items-center justify-center gap-1.5">
          <span className="text-xs text-gray-400 dark:text-gray-600">Press</span>
          <KeyChip k="Esc" />
          <span className="text-xs text-gray-400 dark:text-gray-600">to close</span>
        </div>
      </div>
    </div>
  )
}
