import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'

// The tool functions are not exported directly from executeTool — we test via
// the helper functions by calling executeTool with a temporary workspace.
// Import the module after mocking electron.
import { executeTool } from '../tools'

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
    const result = await executeTool('write_file', { path: 'new.txt', content: 'hello world' }, tmpDir, async () => true, undefined, undefined)
    expect(result.isError).toBe(false)
    expect(readFileSync(join(tmpDir, 'new.txt'), 'utf-8')).toBe('hello world')
  })

  it('overwrites an existing file', async () => {
    writeFileSync(join(tmpDir, 'existing.txt'), 'old content')
    await executeTool('write_file', { path: 'existing.txt', content: 'new content' }, tmpDir, async () => true, undefined, undefined)
    expect(readFileSync(join(tmpDir, 'existing.txt'), 'utf-8')).toBe('new content')
  })
})

describe('executeTool — str_replace', () => {
  it('replaces unique text in a file', async () => {
    writeFileSync(join(tmpDir, 'src.ts'), 'const x = 1\nconst y = 2\n')
    const result = await executeTool(
      'str_replace',
      { path: 'src.ts', old_str: 'const x = 1', new_str: 'const x = 42' },
      tmpDir, async () => true, undefined, undefined
    )
    expect(result.isError).toBe(false)
    expect(readFileSync(join(tmpDir, 'src.ts'), 'utf-8')).toContain('const x = 42')
    expect(readFileSync(join(tmpDir, 'src.ts'), 'utf-8')).toContain('const y = 2')
  })

  it('errors when old_str not found', async () => {
    writeFileSync(join(tmpDir, 'src.ts'), 'const x = 1\n')
    const result = await executeTool(
      'str_replace',
      { path: 'src.ts', old_str: 'DOES_NOT_EXIST', new_str: 'replaced' },
      tmpDir, async () => true, undefined, undefined
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
