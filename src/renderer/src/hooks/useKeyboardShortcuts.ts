import { useEffect } from 'react'

interface Shortcuts {
  onNewChat:         () => void
  onOpenSettings:    () => void
  onCloseSettings:   () => void
  onFocusInput:      () => void
  onPrevConv:        () => void
  onNextConv:        () => void
  onToggleTerminal?: () => void
  onOpenSearch?:     () => void
  onOpenShortcuts?:  () => void
}

export function useKeyboardShortcuts(shortcuts: Shortcuts) {
  useEffect(() => {
    const { onNewChat, onOpenSettings, onCloseSettings, onFocusInput, onPrevConv, onNextConv, onToggleTerminal, onOpenSearch, onOpenShortcuts } = shortcuts

    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      const tag  = (document.activeElement as HTMLElement)?.tagName ?? ''
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (ctrl && e.key === 'n') {
        e.preventDefault()
        onNewChat()
      } else if (ctrl && e.key === ',') {
        e.preventDefault()
        onOpenSettings()
      } else if (ctrl && e.key === '/') {
        e.preventDefault()
        onFocusInput()
      } else if (ctrl && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        // Ctrl+Shift+F — open full-text search
        e.preventDefault()
        onOpenSearch?.()
      } else if (e.key === 'Escape') {
        onCloseSettings()
      } else if (ctrl && e.key === 'ArrowUp' && !inInput) {
        e.preventDefault()
        onPrevConv()
      } else if (ctrl && e.key === 'ArrowDown' && !inInput) {
        e.preventDefault()
        onNextConv()
      } else if (ctrl && e.key === '`') {
        // Ctrl+` — toggle terminal panel (same as VS Code)
        e.preventDefault()
        onToggleTerminal?.()
      } else if (ctrl && e.key === '?') {
        e.preventDefault()
        onOpenShortcuts?.()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // handlers are stable callbacks from App, no need to re-register
}
