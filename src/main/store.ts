import Store from 'electron-store'
import { AppSettings, Conversation, DEFAULT_SETTINGS } from '../shared/types'

// ─── Settings store (encrypted) ────────────────────────────────────────────

const settingsStore = new Store<{ settings: AppSettings }>({
  name: 'settings',
  encryptionKey: 'ai-code-app-secret-key-v1', // encrypts API keys at rest
  defaults: {
    settings: DEFAULT_SETTINGS
  }
})

export function getSettings(): AppSettings {
  return settingsStore.get('settings', DEFAULT_SETTINGS)
}

export function saveSettings(settings: AppSettings): void {
  settingsStore.set('settings', settings)
}

// ─── Conversations store ───────────────────────────────────────────────────

const convStore = new Store<{ conversations: Conversation[] }>({
  name: 'conversations',
  defaults: {
    conversations: []
  }
})

export function getConversations(): Conversation[] {
  return convStore.get('conversations', [])
}

export function saveConversation(conv: Conversation): void {
  const all = getConversations()
  const idx = all.findIndex((c) => c.id === conv.id)
  if (idx >= 0) {
    all[idx] = conv
  } else {
    all.unshift(conv)
  }
  convStore.set('conversations', all.slice(0, 100)) // keep last 100
}

export function deleteConversation(id: string): void {
  const all = getConversations().filter((c) => c.id !== id)
  convStore.set('conversations', all)
}
