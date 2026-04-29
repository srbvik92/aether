import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'

// ── Electron mock (net.fetch) ─────────────────────────────────────────────────
// Must be defined before importing tools so the module sees the mock.
vi.mock('electron', () => ({
  net: {
    fetch: vi.fn(),
  },
}))

// The tool functions are not exported directly from executeTool — we test via
// the helper functions by calling executeTool with a temporary workspace.
// Import the module after mocking electron.
import { executeTool, fetchPageContent } from '../tools'
import { net } from 'electron'

const mockFetch = net.fetch as ReturnType<typeof vi.fn>

const tmpDir = join(os.tmpdir(), `chatui-tools-test-${Date.now()}`)

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('executeTool — read_file', () => {
  it('reads a file with line numbers', async () => {
    writeFileSync(join(tmpDir, 'hello.txt'), 'line one\nline two\nline three')
    const result = await executeTool('read_file', { path: 'hello.txt' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('line one')
    expect(result.output).toContain('1 |')
    expect(result.output).toContain('3 |')
  })

  it('returns error for missing file', async () => {
    const result = await executeTool('read_file', { path: 'missing.txt' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('not found')
  })
})

describe('executeTool — read_file_range', () => {
  it('reads a slice of lines', async () => {
    writeFileSync(join(tmpDir, 'big.txt'), Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'))
    const result = await executeTool('read_file_range', { path: 'big.txt', start_line: 3, end_line: 5 }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('line 3')
    expect(result.output).toContain('line 5')
    expect(result.output).not.toContain('line 1\n')
    expect(result.output).not.toContain('line 6')
  })
})

describe('executeTool — write_file', () => {
  it('creates a new file', async () => {
    // DiffApprovalFn now returns Promise<string | false>; return the content string to approve
    const result = await executeTool('write_file', { path: 'new.txt', content: 'hello world' }, tmpDir, async (_p, _b, after) => after, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(readFileSync(join(tmpDir, 'new.txt'), 'utf-8')).toBe('hello world')
  })

  it('overwrites an existing file', async () => {
    writeFileSync(join(tmpDir, 'existing.txt'), 'old content')
    await executeTool('write_file', { path: 'existing.txt', content: 'new content' }, tmpDir, async (_p, _b, after) => after, undefined, undefined)
    expect(readFileSync(join(tmpDir, 'existing.txt'), 'utf-8')).toBe('new content')
  })

  it('rejects a write when DiffApprovalFn returns false', async () => {
    const result = await executeTool('write_file', { path: 'rejected.txt', content: 'should not exist' }, tmpDir, async () => false, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('rejected')
    expect(existsSync(join(tmpDir, 'rejected.txt'))).toBe(false)
  })
})

describe('executeTool — str_replace', () => {
  it('replaces unique text in a file', async () => {
    writeFileSync(join(tmpDir, 'src.ts'), 'const x = 1\nconst y = 2\n')
    const result = await executeTool(
      'str_replace',
      { path: 'src.ts', old_str: 'const x = 1', new_str: 'const x = 42' },
      tmpDir, async (_p, _b, after) => after, undefined, undefined
    )
    expect(result.isError).toBe(false)
    expect(readFileSync(join(tmpDir, 'src.ts'), 'utf-8')).toContain('const x = 42')
    expect(readFileSync(join(tmpDir, 'src.ts'), 'utf-8')).toContain('const y = 2')
  })

  it('allows partial content override (hunk-level accept)', async () => {
    writeFileSync(join(tmpDir, 'partial.ts'), 'line1\nline2\nline3\n')
    // Simulate hunk-level: approve but return modified content
    const modifiedContent = 'line1\nLINE2_MODIFIED\nline3\n'
    const result = await executeTool(
      'str_replace',
      { path: 'partial.ts', old_str: 'line2', new_str: 'LINE2_MODIFIED' },
      tmpDir, async (_p, _b, _after) => modifiedContent, undefined, undefined
    )
    expect(result.isError).toBe(false)
    expect(readFileSync(join(tmpDir, 'partial.ts'), 'utf-8')).toBe(modifiedContent)
  })

  it('errors when old_str not found', async () => {
    writeFileSync(join(tmpDir, 'src.ts'), 'const x = 1\n')
    const result = await executeTool(
      'str_replace',
      { path: 'src.ts', old_str: 'DOES_NOT_EXIST', new_str: 'replaced' },
      tmpDir, async (_p, _b, after) => after, undefined, undefined
    )
    expect(result.isError).toBe(true)
  })
})

describe('executeTool — list_directory', () => {
  it('lists files in a directory', async () => {
    writeFileSync(join(tmpDir, 'a.ts'), '')
    writeFileSync(join(tmpDir, 'b.ts'), '')
    mkdirSync(join(tmpDir, 'subdir'))
    const result = await executeTool('list_directory', { path: '.' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('a.ts')
    expect(result.output).toContain('b.ts')
    expect(result.output).toContain('subdir')
  })
})

describe('executeTool — search_files', () => {
  it('finds pattern in files', async () => {
    writeFileSync(join(tmpDir, 'foo.ts'), 'export function hello() {}\n')
    writeFileSync(join(tmpDir, 'bar.ts'), 'export function world() {}\n')
    const result = await executeTool('search_files', { pattern: 'hello', path: '.' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('foo.ts')
    expect(result.output).not.toContain('bar.ts')
  })
})

describe('executeTool — unknown tool', () => {
  it('returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', {}, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Unknown tool')
  })
})

describe('executeTool — no workspace', () => {
  it('returns error when no workspace configured', async () => {
    const result = await executeTool('read_file', { path: 'x.txt' }, '', undefined, undefined, undefined)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('workspace')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchPageContent — URL pre-fetch helper (also used by fetch_url IPC handler)
// Manually tested: pasting a URL into the chat shows a collapsible fetch card ✓
// ─────────────────────────────────────────────────────────────────────────────
describe('fetchPageContent', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns cleaned text from an HTML page', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html><head><title>Hello World</title></head><body><main>Some page content here.</main></body></html>',
    })
    const result = await fetchPageContent('https://example.com')
    expect(result).not.toBeNull()
    expect(result).toContain('Hello World')
    expect(result).toContain('Some page content here')
  })

  it('returns raw text for non-HTML content types', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => 'plain text response',
    })
    const result = await fetchPageContent('https://example.com/file.txt')
    expect(result).toBe('plain text response')
  })

  it('truncates content longer than 12 000 chars', async () => {
    const longText = 'x'.repeat(15_000)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => longText,
    })
    const result = await fetchPageContent('https://example.com/big')
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThan(15_000)
    expect(result).toContain('[...truncated]')
  })

  it('returns null when the server returns a non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await fetchPageContent('https://example.com/missing')
    expect(result).toBeNull()
  })

  it('returns null on network error / timeout', async () => {
    mockFetch.mockRejectedValueOnce(new Error('AbortError'))
    const result = await fetchPageContent('https://example.com/slow')
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// executeTool — fetch_url
// Manually tested: AI calls fetch_url with a URL and gets page content back ✓
// ─────────────────────────────────────────────────────────────────────────────
describe('executeTool — fetch_url', () => {
  beforeEach(() => mockFetch.mockReset())

  it('fetches and returns page content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => '<html><body><main>ChatUI documentation page.</main></body></html>',
    })
    const result = await executeTool('fetch_url', { url: 'https://example.com/docs' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Fetched: https://example.com/docs')
    expect(result.output).toContain('ChatUI documentation page')
  })

  it('also accepts URL via .URL and .uri aliases (GPT-5 argument name variants)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: async () => 'alias test ok',
    })
    const result = await executeTool('fetch_url', { URL: 'https://example.com/alias' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('alias test ok')
  })

  it('returns error for an empty URL', async () => {
    const result = await executeTool('fetch_url', { url: '' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('requires a URL')
  })

  it('returns error for a malformed URL', async () => {
    const result = await executeTool('fetch_url', { url: 'not-a-url' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Invalid URL')
  })

  it('returns error when site is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const result = await executeTool('fetch_url', { url: 'https://example.com/down' }, tmpDir, undefined, undefined, undefined)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Could not fetch')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// executeTool — web_search
// Manually tested: asking "what is today's date / current time" triggers
// web_search with a date/time query and returns live results ✓
// ─────────────────────────────────────────────────────────────────────────────
describe('executeTool — web_search', () => {
  beforeEach(() => mockFetch.mockReset())

  const BRAVE_KEY = 'test-brave-key'

  function mockSearchThenFetch(results: Array<{ title: string; url: string; description?: string }>) {
    // First call: Brave Search API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ web: { results } }),
    })
    // Subsequent calls: page fetches for top-2 auto-fetch
    results.slice(0, 2).forEach(r => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'text/plain' },
        text: async () => `Content from ${r.title}`,
      })
    })
  }

  it('returns search results with auto-fetched page content', async () => {
    mockSearchThenFetch([
      { title: 'Current Date & Time', url: 'https://time.is', description: 'Exact time for any timezone.' },
      { title: 'World Clock', url: 'https://worldclock.com', description: 'World time zones.' },
    ])
    const result = await executeTool('web_search', { query: 'current date and time' }, tmpDir, undefined, undefined, BRAVE_KEY)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('current date and time')
    expect(result.output).toContain('Current Date & Time')
    expect(result.output).toContain('Content from Current Date & Time')   // auto-fetched inline
    expect(result.output).toContain('Content from World Clock')
  })

  it('accepts query via .q and .search_query aliases', async () => {
    mockSearchThenFetch([{ title: 'Result', url: 'https://example.com' }])
    const result = await executeTool('web_search', { q: 'alias query' }, tmpDir, undefined, undefined, BRAVE_KEY)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('alias query')
  })

  it('returns error when query is empty', async () => {
    const result = await executeTool('web_search', { query: '' }, tmpDir, undefined, undefined, BRAVE_KEY)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('requires a query')
  })

  it('returns error when Brave API key is missing', async () => {
    const result = await executeTool('web_search', { query: 'current time' }, tmpDir, undefined, undefined, '')
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Brave Search API key')
  })

  it('returns error on Brave API HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
    const result = await executeTool('web_search', { query: 'current time' }, tmpDir, undefined, undefined, BRAVE_KEY)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Brave Search API error')
    expect(result.output).toContain('401')
  })

  it('returns no-results message gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ web: { results: [] } }),
    })
    const result = await executeTool('web_search', { query: 'xyzzy nonsense query 12345' }, tmpDir, undefined, undefined, BRAVE_KEY)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('No results found')
  })
})
