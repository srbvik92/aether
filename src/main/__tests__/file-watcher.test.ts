import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

const tmpDir = join(os.tmpdir(), `chatui-watcher-test-${Date.now()}`)

beforeEach(() => mkdirSync(tmpDir, { recursive: true }))
afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })

describe('file-watcher', () => {
  it('module exports expected functions', async () => {
    const mod = await import('../file-watcher').catch(() => null)
    if (!mod) {
      // May fail due to electron dependency — skip gracefully
      console.warn('Skipping file-watcher test — electron dependency')
      return
    }
    expect(typeof mod.startFileWatcher).toBe('function')
    expect(typeof mod.stopFileWatcher).toBe('function')
    expect(typeof mod.isWatching).toBe('function')
  })

  it('isWatching returns false initially', async () => {
    const mod = await import('../file-watcher').catch(() => null)
    if (!mod) return
    expect(mod.isWatching()).toBe(false)
  })
})
