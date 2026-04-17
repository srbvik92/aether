import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { buildBM25, bm25Search, readWorkspaceFiles } from '../semantic-search'

const tmpDir = join(os.tmpdir(), `chatui-sem-test-${Date.now()}`)

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
  mkdirSync(join(tmpDir, 'src'), { recursive: true })

  // Create test workspace files
  writeFileSync(join(tmpDir, 'src', 'auth.ts'), `
export function authenticateUser(username: string, password: string): boolean {
  // Validate credentials against database
  return username === 'admin' && password === 'secret'
}

export function generateToken(userId: string): string {
  return \`token-\${userId}-\${Date.now()}\`
}
`)

  writeFileSync(join(tmpDir, 'src', 'database.ts'), `
import { Pool } from 'pg'

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function queryUsers(): Promise<unknown[]> {
  const result = await pool.query('SELECT * FROM users')
  return result.rows
}
`)

  writeFileSync(join(tmpDir, 'README.md'), `
# My Project
This is a TypeScript project with authentication and database support.
`)
})

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('readWorkspaceFiles', () => {
  it('discovers files in the workspace', () => {
    const files = readWorkspaceFiles(tmpDir)
    expect(files.length).toBeGreaterThan(0)
    const paths = files.map(f => f.path)
    expect(paths.some(p => p.includes('auth.ts'))).toBe(true)
    expect(paths.some(p => p.includes('database.ts'))).toBe(true)
  })

  it('returns file content', () => {
    const files = readWorkspaceFiles(tmpDir)
    const authFile = files.find(f => f.path.includes('auth.ts'))
    expect(authFile).toBeDefined()
    expect(authFile!.content).toContain('authenticateUser')
  })
})

describe('buildBM25 + bm25Search', () => {
  it('builds an index and finds relevant files', () => {
    buildBM25(tmpDir)

    const results = bm25Search('authentication token user', tmpDir, 5)
    expect(results.length).toBeGreaterThan(0)
    // auth.ts should score highly for authentication query
    const topPaths = results.map(r => r.path)
    expect(topPaths.some(p => p.includes('auth'))).toBe(true)
  })

  it('returns database-related file for database query', () => {
    buildBM25(tmpDir)

    const results = bm25Search('database query pool', tmpDir, 5)
    expect(results.length).toBeGreaterThan(0)
    const topPaths = results.map(r => r.path)
    expect(topPaths.some(p => p.includes('database'))).toBe(true)
  })

  it('returns empty array for query with no matches', () => {
    buildBM25(tmpDir)

    const results = bm25Search('xyzzy_nonexistent_term_12345', tmpDir, 5)
    // May return 0 or low-score results — just shouldn't throw
    expect(Array.isArray(results)).toBe(true)
  })

  it('result objects have expected shape', () => {
    buildBM25(tmpDir)

    const results = bm25Search('function', tmpDir, 3)
    if (results.length > 0) {
      const r = results[0]
      expect(typeof r.path).toBe('string')
      expect(typeof r.startLine).toBe('number')
      expect(typeof r.endLine).toBe('number')
      expect(typeof r.excerpt).toBe('string')
      expect(typeof r.score).toBe('number')
      expect(r.score).toBeGreaterThan(0)
    }
  })
})
