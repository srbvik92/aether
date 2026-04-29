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
  const stored = settingsStore.get('settings', DEFAULT_SETTINGS)
  // Spread defaults first so any new fields added to DEFAULT_SETTINGS are
  // automatically available to existing installs.  Then overlay stored values
  // so the user's choices are preserved.  Explicitly restore systemPrompt when
  // it is blank — the stored value may be '' from older versions where the
  // good default prompt hadn't been written yet.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    systemPrompt: stored.systemPrompt?.trim() || DEFAULT_SETTINGS.systemPrompt,
  }
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
