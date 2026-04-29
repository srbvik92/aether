/**
 * SlashCommandMenu — popup shown when the user types "/" in the chat input.
 * Appears above the textarea like a mini command palette; arrow keys + Enter/Tab
 * to select, Escape to dismiss.
 */

import { useEffect, useRef, useState } from 'react'

export interface SlashCommand {
  name:        string   // e.g. "fix"
  label:       string   // e.g. "Fix bug"
  icon:        string   // emoji
  description: string   // short one-liner shown in the row
  prompt:      string   // text inserted into the textarea
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name:        'fix',
    label:       'Fix bug',
    icon:        '🔧',
    description: 'Find and fix the bug, then explain what was wrong',
    prompt:      'Fix the bug in the code and explain what was wrong.',
  },
  {
    name:        'test',
    label:       'Write tests',
    icon:        '🧪',
    description: 'Generate unit tests with edge cases',
    prompt:      'Write comprehensive unit tests for this code, including edge cases.',
  },
  {
    name:        'explain',
    label:       'Explain code',
    icon:        '💡',
    description: 'Explain the code in plain English',
    prompt:      'Explain this code in plain English — what it does, how it works, and why.',
  },
  {
    name:        'improve',
    label:       'Improve',
    icon:        '✨',
    description: 'Refactor for clarity, performance, and best practices',
    prompt:      'Improve this code — focus on readability, performance, and best practices. Show the changes.',
  },
  {
    name:        'refactor',
    label:       'Refactor',
    icon:        '🔄',
    description: 'Restructure without changing behaviour',
    prompt:      'Refactor this code to be cleaner and more maintainable, without changing its behaviour.',
  },
  {
    name:        'review',
    label:       'Code review',
    icon:        '🔍',
    description: 'Review for bugs, security issues, and improvements',
    prompt:      'Review this code for bugs, security vulnerabilities, and potential improvements. Be specific.',
  },
  {
    name:        'docs',
    label:       'Add docs',
    icon:        '📝',
    description: 'Add JSDoc / docstrings and inline comments',
    prompt:      'Add clear documentation and inline comments to this code.',
  },
  {
    name:        'optimize',
    label:       'Optimize',
    icon:        '⚡',
    description: 'Profile and optimize for speed or memory',
    prompt:      'Optimize this code for performance. Identify bottlenecks and apply targeted improvements.',
  },
  {
    name:        'types',
    label:       'Add types',
    icon:        '🏷️',
    description: 'Add TypeScript / type annotations',
    prompt:      'Add proper TypeScript types and annotations to this code.',
  },
  {
    name:        'summary',
    label:       'Summarize',
    icon:        '📋',
    description: 'Summarize the conversation so far',
    prompt:      'Summarize what we have discussed so far in a few concise bullet points.',
  },
]

interface Props {
  query:    string                       // text after the "/"
  onSelect: (cmd: SlashCommand) => void
  onClose:  () => void
  /** Forwarded from the parent so the menu can consume arrow key events */
  activeIndex: number
  onActiveIndexChange: (i: number) => void
}

export default function SlashCommandMenu({ query, onSelect, onClose, activeIndex, onActiveIndexChange }: Props) {
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = SLASH_COMMANDS.filter(c =>
    c.name.startsWith(query.toLowerCase()) ||
    c.label.toLowerCase().includes(query.toLowerCase())
  )

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLLIElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (filtered.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-0 mb-1 w-80 bg-white dark:bg-gray-900
                 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg
                 overflow-hidden z-50"
    >
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          Slash commands
        </span>
        <span className="text-[10px] text-gray-300 dark:text-gray-600 ml-auto">↑↓ navigate · Enter select · Esc close</span>
      </div>

      {/* List */}
      <ul ref={listRef} className="max-h-60 overflow-y-auto py-1">
        {filtered.map((cmd, i) => (
          <li key={cmd.name}>
            <button
              onMouseDown={e => { e.preventDefault(); onSelect(cmd) }}
              onMouseEnter={() => onActiveIndexChange(i)}
              className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                i === activeIndex
                  ? 'bg-blue-50 dark:bg-blue-900/30'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span className="text-base leading-none mt-0.5 flex-shrink-0">{cmd.icon}</span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                    /{cmd.name}
                  </span>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">{cmd.label}</span>
                </span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {cmd.description}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Returns filtered commands for a given query string */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  return SLASH_COMMANDS.filter(c =>
    c.name.startsWith(q) || c.label.toLowerCase().includes(q)
  )
}
