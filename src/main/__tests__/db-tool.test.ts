import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'

const tmpDir = join(os.tmpdir(), `chatui-db-test-${Date.now()}`)

beforeAll(() => mkdirSync(tmpDir, { recursive: true }))
afterAll(() => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ } })

describe('queryDatabase — SQLite', () => {
  it('creates and queries an SQLite database', async () => {
    // Dynamically import to skip if better-sqlite3 not installed
    let Database: unknown
    try {
      const mod = await import('better-sqlite3')
      Database = (mod as { default: unknown }).default ?? mod
    } catch {
      console.warn('Skipping SQLite test — better-sqlite3 not installed')
      return
    }

    // Create a test database
    const dbPath = join(tmpDir, 'test.db')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new (Database as any)(dbPath)
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')
    db.exec("INSERT INTO users VALUES (1, 'Alice', 30)")
    db.exec("INSERT INTO users VALUES (2, 'Bob', 25)")
    db.close()

    const { queryDatabase } = await import('../db-tool')
    const result = await queryDatabase(dbPath, 'SELECT * FROM users ORDER BY id', tmpDir)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Alice')
    expect(result.output).toContain('Bob')
    expect(result.output).toContain('id')
    expect(result.output).toContain('name')
  })

  it('handles bad SQLite path gracefully', async () => {
    const { queryDatabase } = await import('../db-tool')
    const result = await queryDatabase('/nonexistent/path/to.db', 'SELECT 1', tmpDir)
    expect(result.isError).toBe(true)
  })

  it('returns meaningful error for bad SQL', async () => {
    let Database: unknown
    try {
      const mod = await import('better-sqlite3')
      Database = (mod as { default: unknown }).default ?? mod
    } catch {
      return // skip if not installed
    }

    const dbPath = join(tmpDir, 'test2.db')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new (Database as any)(dbPath)
    db.exec('CREATE TABLE t (id INTEGER)')
    db.close()

    const { queryDatabase } = await import('../db-tool')
    const result = await queryDatabase(dbPath, 'SELECT * FROM nonexistent_table', tmpDir)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('error')
  })

  it('detects unknown connection string type', async () => {
    const { queryDatabase } = await import('../db-tool')
    const result = await queryDatabase('not-a-valid-connection-string-at-all', 'SELECT 1', tmpDir)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Cannot infer database type')
  })
})
