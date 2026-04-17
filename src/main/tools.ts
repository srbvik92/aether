/**
 * Tool definitions and executors for the AI agent loop.
 *
 * Safety rules enforced here:
 *   - All file paths are resolved against the workspace root
 *   - Paths escaping the workspace are rejected (path-traversal protection)
 *   - Shell commands have a 30-second hard timeout
 *   - Tool output is capped at MAX_OUTPUT_CHARS to avoid flooding the context window
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs'
import { join, resolve, relative, dirname } from 'path'
import { spawn } from 'child_process'
import Anthropic from '@anthropic-ai/sdk'
import { getGitStatus, getGitDiff, getGitLog, gitAdd, gitCommit, isGitRepo } from './git'
import { bm25Search } from './semantic-search'
import { queryDatabase } from './db-tool'
import {
  browserNavigate, browserClick, browserFill,
  browserGetText, browserScreenshot, browserEval, browserClose
} from './browser-tool'

// Callback that pauses the agent and asks the user to approve a file write
export type DiffApprovalFn = (
  path: string,
  before: string,
  after: string,
  isNew: boolean
) => Promise<boolean>

// ── Output cap ────────────────────────────────────────────────────────────────
const MAX_OUTPUT_CHARS = 50_000

function cap(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text
  const half = MAX_OUTPUT_CHARS / 2
  return (
    text.slice(0, half) +
    `\n\n[... ${text.length - MAX_OUTPUT_CHARS} chars truncated ...]\n\n` +
    text.slice(-half)
  )
}

// ── Path safety ───────────────────────────────────────────────────────────────
function safePath(workspace: string, filePath: string): string {
  const abs = resolve(workspace, filePath)
  const root = resolve(workspace)
  if (!abs.startsWith(root + '\\') && abs !== root &&
      !abs.startsWith(root + '/')) {
    throw new Error(`Path "${filePath}" is outside the workspace (${workspace})`)
  }
  return abs
}

// ── Tool result type ──────────────────────────────────────────────────────────
export interface ToolResult {
  output:  string
  isError: boolean
}

// ── Individual tool implementations ──────────────────────────────────────────

const LARGE_FILE_THRESHOLD = 300  // lines — above this, suggest read_file_range

function readFile(filePath: string, workspace: string): ToolResult {
  const abs = safePath(workspace, filePath)
  if (!existsSync(abs)) return { output: `File not found: ${filePath}`, isError: true }
  const content = readFileSync(abs, 'utf-8')
  const lines = content.split('\n')
  // Prefix every line with its number so the model can make precise str_replace calls
  const numbered = lines.map((l, i) => `${String(i + 1).padStart(4, ' ')} | ${l}`).join('\n')

  // Warn on large files so the AI uses read_file_range on subsequent reads
  const hint = lines.length > LARGE_FILE_THRESHOLD
    ? `\n\n💡 Large file (${lines.length} lines). ` +
      `For future reads of this file use read_file_range(path, startLine, endLine) ` +
      `to fetch only the relevant section and save context.`
    : ''

  return { output: cap(numbered) + hint, isError: false }
}

function readFileRange(filePath: string, startLine: number, endLine: number, workspace: string): ToolResult {
  const abs = safePath(workspace, filePath)
  if (!existsSync(abs)) return { output: `File not found: ${filePath}`, isError: true }
  const lines = readFileSync(abs, 'utf-8').split('\n')
  const start = Math.max(1, startLine)
  const end   = Math.min(lines.length, endLine)
  const slice = lines.slice(start - 1, end)
  const numbered = slice.map((l, i) => `${String(start + i).padStart(4, ' ')} | ${l}`).join('\n')
  return {
    output: `${filePath} lines ${start}–${end} (of ${lines.length}):\n${cap(numbered)}`,
    isError: false
  }
}

function strReplace(
  filePath: string,
  oldStr: string,
  newStr: string,
  workspace: string,
  onDiffRequest?: DiffApprovalFn
): Promise<ToolResult> {
  return (async () => {
    const abs = safePath(workspace, filePath)
    if (!existsSync(abs)) return { output: `File not found: ${filePath}`, isError: true }

    const before = readFileSync(abs, 'utf-8')

    // Count occurrences — must be exactly one to avoid ambiguous replacements
    const occurrences = before.split(oldStr).length - 1
    if (occurrences === 0) {
      return {
        output: `str_replace failed: the old_str was not found in ${filePath}.\n` +
          `Tip: use read_file to check the exact current content and whitespace.`,
        isError: true
      }
    }
    if (occurrences > 1) {
      return {
        output: `str_replace failed: old_str appears ${occurrences} times in ${filePath} — it must be unique.\n` +
          `Add more surrounding lines to make it unambiguous.`,
        isError: true
      }
    }

    const after = before.replace(oldStr, newStr)

    if (onDiffRequest) {
      const approved = await onDiffRequest(filePath, before, after, false)
      if (!approved) {
        return { output: `Edit to "${filePath}" was rejected by the user.`, isError: false }
      }
    }

    writeFileSync(abs, after, 'utf-8')
    // Report what changed
    const oldLines = oldStr.split('\n').length
    const newLines = newStr.split('\n').length
    return {
      output: `Edited ${filePath}: replaced ${oldLines}-line block with ${newLines}-line block.`,
      isError: false
    }
  })()
}

async function writeFile(
  filePath: string,
  content: string,
  workspace: string,
  onDiffRequest?: DiffApprovalFn
): Promise<ToolResult> {
  const abs   = safePath(workspace, filePath)
  const isNew = !existsSync(abs)
  const before = isNew ? '' : (() => { try { return readFileSync(abs, 'utf-8') } catch { return '' } })()

  // If no change, skip writing
  if (!isNew && before === content) {
    return { output: `No changes to ${filePath}`, isError: false }
  }

  // Ask user to approve the diff (if callback provided)
  if (onDiffRequest) {
    const approved = await onDiffRequest(filePath, before, content, isNew)
    if (!approved) {
      return {
        output: `Write to "${filePath}" was rejected by the user. Do not retry this write unless the user asks you to.`,
        isError: false
      }
    }
  }

  const dir = dirname(abs)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(abs, content, 'utf-8')
  return {
    output: isNew
      ? `Created ${filePath} (${content.length} chars)`
      : `Updated ${filePath} (${content.length} chars)`,
    isError: false
  }
}

function listDirectory(dirPath: string, workspace: string): ToolResult {
  const abs = safePath(workspace, dirPath)
  if (!existsSync(abs)) return { output: `Directory not found: ${dirPath}`, isError: true }

  const entries = readdirSync(abs)
  const lines: string[] = []

  for (const name of entries.sort()) {
    try {
      const entryPath = join(abs, name)
      const stats = statSync(entryPath)
      if (stats.isDirectory()) {
        lines.push(`  📁  ${name}/`)
      } else {
        const size = stats.size < 1024
          ? `${stats.size} B`
          : stats.size < 1024 * 1024
            ? `${(stats.size / 1024).toFixed(1)} KB`
            : `${(stats.size / 1024 / 1024).toFixed(1)} MB`
        lines.push(`  📄  ${name}  (${size})`)
      }
    } catch {
      lines.push(`  ❓  ${name}`)
    }
  }

  const header = `Contents of ${dirPath || '.'} (${lines.length} entries):\n`
  return { output: cap(header + lines.join('\n')), isError: false }
}

function searchFiles(pattern: string, searchPath: string, workspace: string): ToolResult {
  const abs = safePath(workspace, searchPath || '.')
  if (!existsSync(abs)) return { output: `Path not found: ${searchPath}`, isError: true }

  const results: string[] = []
  const MAX_RESULTS = 200

  function walkDir(dir: string) {
    if (results.length >= MAX_RESULTS) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }

    for (const name of entries) {
      if (results.length >= MAX_RESULTS) break
      // Skip common noise dirs
      if (['.git', 'node_modules', '.next', 'dist', 'out', '__pycache__', '.venv'].includes(name)) continue

      const full = join(dir, name)
      let stats
      try { stats = statSync(full) } catch { continue }

      if (stats.isDirectory()) {
        walkDir(full)
      } else {
        try {
          const content = readFileSync(full, 'utf-8')
          const lines = content.split('\n')
          const regex = new RegExp(pattern, 'gi')

          lines.forEach((line, i) => {
            if (regex.test(line) && results.length < MAX_RESULTS) {
              const rel = relative(workspace, full)
              results.push(`${rel}:${i + 1}:  ${line.trim()}`)
            }
            regex.lastIndex = 0  // reset for global flag
          })
        } catch { /* skip binary files */ }
      }
    }
  }

  try {
    walkDir(abs)
  } catch (err) {
    return { output: `Search error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }

  if (results.length === 0) return { output: `No matches found for "${pattern}" in ${searchPath || '.'}`, isError: false }

  const header = `Found ${results.length}${results.length >= MAX_RESULTS ? '+' : ''} matches for "${pattern}":\n\n`
  return { output: cap(header + results.join('\n')), isError: false }
}

function runCommand(
  command: string,
  workspace: string,
  onChunk?: (chunk: string) => void
): Promise<ToolResult> {
  if (!workspace) {
    return Promise.resolve({ output: 'No workspace set — cannot run commands without a workspace directory.', isError: true })
  }

  // ── Approval gate ─────────────────────────────────────────────────────────
  const dangerous = isDangerousCommand(command)
  const trusted   = !dangerous && _trustedCommands.some(t =>
    command.trim().toLowerCase().startsWith(t.toLowerCase())
  )

  if (!trusted && _cmdApprovalFn) {
    return _cmdApprovalFn(command, workspace, dangerous).then(approved => {
      if (!approved) {
        return { output: 'Command was not approved by the user. Do not retry this command unless the user explicitly asks.', isError: false }
      }
      return runCommandImpl(command, workspace, onChunk)
    })
  }

  return runCommandImpl(command, workspace, onChunk)
}

function runCommandImpl(
  command: string,
  workspace: string,
  onChunk?: (chunk: string) => void
): Promise<ToolResult> {
  return new Promise((resolve) => {
    // Use shell:true so the command string works the same as execSync
    const child = spawn(command, {
      cwd:   workspace,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let combined = ''

    const handleData = (data: Buffer) => {
      const chunk = data.toString('utf-8')
      combined += chunk
      onChunk?.(chunk)
    }

    child.stdout.on('data', handleData)
    child.stderr.on('data', handleData)

    // Hard 30-second timeout
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({
        output:  cap((combined.trim() || '(no output)') + '\n\n[timed out after 30s]'),
        isError: true
      })
    }, 30_000)

    child.on('close', (code) => {
      clearTimeout(timer)
      const out = combined.trim() || '(command completed with no output)'

      // Detect test-runner failures and add an explicit directive so the agent
      // self-corrects rather than reporting "done" with broken tests.
      const isTestCommand = /\b(test|spec|jest|vitest|mocha|pytest|cargo test|go test|rspec|cypress|playwright)\b/i.test(command)
      const hasTestFailure = code !== 0 && isTestCommand
      const failurePatterns = [
        /\d+ (failed|failing|failures)/i,
        /FAIL\b/,
        /Tests:\s+\d+ failed/i,
        /AssertionError/i,
        /FAILED \(/,       // pytest
        /test result: FAILED/i  // Rust
      ]
      const looksLikeFail = failurePatterns.some(p => p.test(out))

      if (hasTestFailure || looksLikeFail) {
        return resolve({
          output: cap(out) +
            '\n\n⚠️  Tests are failing. Do NOT report the task as done. ' +
            'Read the failure messages above, locate the broken code, fix it, ' +
            'then run the tests again. Repeat until all tests pass.',
          isError: true
        })
      }

      resolve({ output: cap(out), isError: code !== 0 })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ output: cap(err.message), isError: true })
    })
  })
}

// ── Git tool implementations ──────────────────────────────────────────────────

function toolGitStatus(workspace: string): ToolResult {
  if (!isGitRepo(workspace)) return { output: 'This workspace is not a git repository.', isError: false }
  const status = getGitStatus(workspace)
  if (!status) return { output: 'Could not read git status.', isError: true }

  const lines: string[] = [`Branch: ${status.branch}`]
  if (status.isClean) {
    lines.push('Working tree is clean — nothing to commit.')
  } else {
    if (status.staged.length)    lines.push(`\nStaged changes (${status.staged.length}):`,    ...status.staged.map(f => `  ${f.status}  ${f.path}`))
    if (status.unstaged.length)  lines.push(`\nUnstaged changes (${status.unstaged.length}):`, ...status.unstaged.map(f => `  ${f.status}  ${f.path}`))
    if (status.untracked.length) lines.push(`\nUntracked files (${status.untracked.length}):`, ...status.untracked.slice(0, 20).map(f => `  ${f.path}`))
  }
  if (status.upstream) {
    lines.push(`\nRemote: ${status.upstream}  ↑${status.ahead} ↓${status.behind}`)
  }
  return { output: lines.join('\n'), isError: false }
}

function toolGitDiff(staged: boolean, filePath: string | undefined, workspace: string): ToolResult {
  if (!isGitRepo(workspace)) return { output: 'Not a git repository.', isError: false }
  const diff = getGitDiff(workspace, { staged, path: filePath })
  return { output: diff, isError: false }
}

function toolGitLog(count: number, workspace: string): ToolResult {
  if (!isGitRepo(workspace)) return { output: 'Not a git repository.', isError: false }
  const log = getGitLog(workspace, Math.min(count || 10, 50))
  return { output: log, isError: false }
}

function toolGitAdd(paths: string[], workspace: string): ToolResult {
  if (!isGitRepo(workspace)) return { output: 'Not a git repository.', isError: true }
  const result = gitAdd(workspace, paths)
  return { output: result.output, isError: !result.ok }
}

function toolGitCommit(message: string, workspace: string): ToolResult {
  if (!isGitRepo(workspace)) return { output: 'Not a git repository.', isError: true }
  const result = gitCommit(workspace, message)
  return { output: result.output, isError: !result.ok }
}

// ── Web tools ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchUrl(url: string): Promise<ToolResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Coding-Assistant/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,*/*'
      },
      signal: AbortSignal.timeout(15_000)
    })

    if (!response.ok) {
      return { output: `HTTP ${response.status} ${response.statusText} — could not fetch ${url}`, isError: true }
    }

    const contentType = response.headers.get('content-type') ?? ''
    const raw = await response.text()

    let content: string
    if (contentType.includes('text/html')) {
      // Try to extract <title> and <main>/<article> first for a cleaner result
      const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const title = titleMatch ? stripHtml(titleMatch[1]) : ''

      // Prefer main content areas over full body
      const mainMatch = raw.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i)
      const body = stripHtml(mainMatch ? mainMatch[1] : raw)

      content = (title ? `# ${title}\n\n` : '') + body
    } else {
      content = raw
    }

    const truncated = content.length > 20_000
      ? content.slice(0, 20_000) + `\n\n[... content truncated at 20,000 chars ...]`
      : content

    return { output: `[Fetched: ${url}]\n\n${truncated}`, isError: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { output: `Failed to fetch ${url}: ${msg}`, isError: true }
  }
}

async function webSearch(query: string, apiKey: string): Promise<ToolResult> {
  if (!apiKey?.trim()) {
    return {
      output: 'Web search requires a Brave Search API key.\nAdd it in Settings → Web Search → Brave API Key.\nGet a free key at https://brave.com/search/api/ (2,000 queries/month free).',
      isError: true
    }
  }

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8&text_decorations=false`
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      },
      signal: AbortSignal.timeout(10_000)
    })

    if (!response.ok) {
      return { output: `Brave Search API error: ${response.status} ${response.statusText}`, isError: true }
    }

    const data = await response.json() as {
      web?: { results?: Array<{ title: string; url: string; description?: string }> }
    }

    const results = data.web?.results ?? []
    if (results.length === 0) {
      return { output: `No results found for: "${query}"`, isError: false }
    }

    const formatted = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description ?? ''}`
    ).join('\n\n')

    // Append a directive so the AI fetches actual page content rather than
    // answering from snippet summaries, which are often incomplete.
    const fetchDirective =
      '\n\n📖 These are snippet summaries only. ' +
      'Call fetch_url on the 1–3 most relevant URLs above to read their full content ' +
      'before forming your answer. If the results do not answer the question, ' +
      'call web_search again with different or more specific keywords.'

    return { output: `Web search results for "${query}":\n\n${formatted}${fetchDirective}`, isError: false }
  } catch (err) {
    return { output: `Search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

// ── Global memory tool ────────────────────────────────────────────────────────
// Stores facts that apply to ALL projects (not workspace-specific).
// The path is set once at startup by ipc-handlers.ts after app is ready.

// ── Custom tool plugins (.ai-context/tools/*.js) ──────────────────────────────

export interface CustomPlugin {
  name:        string
  description: string
  parameters:  Record<string, unknown>  // JSON Schema "properties" shape
  execute:     (params: Record<string, unknown>) => Promise<string | ToolResult>
}

let _customPlugins: CustomPlugin[] = []

export function setCustomPlugins(plugins: CustomPlugin[]): void {
  _customPlugins = plugins
}

export function getCustomPlugins(): CustomPlugin[] {
  return _customPlugins
}

/** Returns Anthropic-compatible tool definitions for the loaded plugins */
export function getCustomToolDefinitions(): import('@anthropic-ai/sdk').Tool[] {
  return _customPlugins.map(p => ({
    name:         p.name,
    description:  p.description,
    input_schema: { type: 'object' as const, properties: p.parameters as Record<string, unknown>, required: [] }
  }))
}

let _globalMemoryPath: string | null = null

export function setGlobalMemoryPath(p: string): void {
  _globalMemoryPath = p
}

// ── Disabled tools (set from project config per turn) ─────────────────────────

let _disabledTools: Set<string> = new Set()

export function setDisabledTools(tools: string[]): void {
  _disabledTools = new Set(tools)
}

// ── Shell command approval (set per turn from ipc-handlers) ───────────────────

type CmdApprovalFn = (command: string, workspace: string, isDangerous: boolean) => Promise<boolean>
let _cmdApprovalFn: CmdApprovalFn | null = null
let _trustedCommands: string[] = []

export function setCmdApprovalFn(fn: CmdApprovalFn | null): void {
  _cmdApprovalFn = fn
}

export function setTrustedCommands(commands: string[]): void {
  _trustedCommands = commands
}

// Patterns that always require explicit approval (regardless of trusted list)
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-\S*f\S*|-\S*r\S*){2}/i,  // rm -rf (any order of flags containing r and f)
  /\brm\s+-rf\b/i,
  /\brm\s+-fr\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+(push|reset)\s+.*--force\b/i,
  /\bdrop\s+table\b/i,
  /\bdrop\s+database\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s+[a-z]:\\/i,             // Windows format C:\
  /\bmkfs\b/i,
  /\bdd\s+.*\bof=/i,
  /\bdel\s+.*\/[sf]\b/i,              // Windows del /s /f
  /\brd\s+\/s\b/i,                    // Windows rmdir /s
]

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command))
}

function rememberGlobally(note: string): ToolResult {
  if (!_globalMemoryPath) {
    return { output: 'Global memory not initialised — this is a bug. Please report it.', isError: true }
  }
  const date  = new Date().toISOString().slice(0, 10)
  const entry = `- [${date}] ${note.trim()}\n`

  let existing = ''
  if (existsSync(_globalMemoryPath)) {
    existing = readFileSync(_globalMemoryPath, 'utf-8')
    if (existing && !existing.endsWith('\n')) existing += '\n'
  } else {
    existing = '# Global Memory\n\n'
  }

  writeFileSync(_globalMemoryPath, existing + entry, 'utf-8')
  return {
    output: `Saved to global memory (all projects): "${note.trim()}"`,
    isError: false
  }
}

// ── Project memory tool ───────────────────────────────────────────────────────

const MEMORY_DIR  = '.ai-memory'
const MEMORY_FILE = '.ai-memory/notes.md'

function rememberNote(note: string, workspace: string): ToolResult {
  const absDir  = join(workspace, MEMORY_DIR)
  const absFile = join(workspace, MEMORY_FILE)

  if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true })

  const date  = new Date().toISOString().slice(0, 10)
  const entry = `- [${date}] ${note.trim()}\n`

  let existing = ''
  if (existsSync(absFile)) {
    existing = readFileSync(absFile, 'utf-8')
    if (existing && !existing.endsWith('\n')) existing += '\n'
  } else {
    existing = '# Project Memory\n\n'
  }

  writeFileSync(absFile, existing + entry, 'utf-8')
  return { output: `Saved to project memory: "${note.trim()}"`, isError: false }
}

// ── Auto-validator ────────────────────────────────────────────────────────────
// After every file write, detect the project type and run its type-checker.
// Errors are returned as a string so the agent loop can append them to the
// tool result and force the AI to self-correct before declaring "done".

interface ValidatorConfig {
  name:    string
  command: string
}

function detectValidator(workspace: string): ValidatorConfig | null {
  // TypeScript — check tsconfig.json or package.json devDependencies
  if (existsSync(join(workspace, 'tsconfig.json'))) {
    return { name: 'TypeScript', command: 'npx tsc --noEmit' }
  }
  // Rust
  if (existsSync(join(workspace, 'Cargo.toml'))) {
    return { name: 'Rust', command: 'cargo check 2>&1' }
  }
  // Go
  if (existsSync(join(workspace, 'go.mod'))) {
    return { name: 'Go', command: 'go build ./...' }
  }
  // Python — mypy if config exists
  if (existsSync(join(workspace, 'mypy.ini')) ||
      existsSync(join(workspace, '.mypy.ini')) ||
      existsSync(join(workspace, 'pyrightconfig.json'))) {
    return { name: 'Python type-check', command: 'mypy . --ignore-missing-imports 2>&1' }
  }
  return null
}

/**
 * Run the workspace type-checker. Returns null if no checker is detected or
 * if the check passes cleanly. Returns an error string on failure so the
 * caller can append it to the tool result.
 */
export async function runAutoValidator(workspace: string): Promise<string | null> {
  const cfg = detectValidator(workspace)
  if (!cfg) return null

  return new Promise((resolve) => {
    const child = spawn(cfg.command, {
      cwd: workspace, shell: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    const onData = (d: Buffer) => { out += d.toString('utf-8') }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null) }, 20_000)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve(null)   // clean — nothing to report
      const trimmed = out.trim()
      if (!trimmed) return resolve(null)
      resolve(
        `\n\n🔴 ${cfg.name} check failed after your edit:\n\`\`\`\n` +
        trimmed.slice(0, 3000) +                          // cap at 3K chars
        (trimmed.length > 3000 ? '\n… (truncated)' : '') +
        '\n\`\`\`\n' +
        `Fix ALL errors above before proceeding. Do not report the task as done until \`${cfg.command}\` passes cleanly.`
      )
    })
    child.on('error', () => resolve(null))   // validator not installed — silently skip
  })
}

// ── Task plan tool ────────────────────────────────────────────────────────────

const PLAN_FILE = '.ai-context/current-plan.md'

function writePlan(plan: string, workspace: string): ToolResult {
  const absDir  = join(workspace, '.ai-context')
  const absFile = join(workspace, PLAN_FILE)

  if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true })

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const content   = `<!-- plan created ${timestamp} -->\n${plan.trim()}\n`
  writeFileSync(absFile, content, 'utf-8')

  // Echo the plan back so it appears in the tool-use panel
  return {
    output: `Plan saved. Proceeding with:\n\n${plan.trim()}`,
    isError: false
  }
}

// ── Project summary tool ──────────────────────────────────────────────────────

const SUMMARY_DIR  = '.ai-context'
const SUMMARY_FILE = '.ai-context/PROJECT.md'

function updateProjectSummary(content: string, workspace: string): ToolResult {
  const absDir  = join(workspace, SUMMARY_DIR)
  const absFile = join(workspace, SUMMARY_FILE)

  if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true })

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const header    = `<!-- ai-context: auto-generated by ChatUI on ${timestamp} -->\n`
  writeFileSync(absFile, header + content.trim() + '\n', 'utf-8')

  return {
    output: `Project summary saved to ${SUMMARY_FILE}. Any AI tool can now read this file to understand the project.`,
    isError: false
  }
}

// ── Semantic search tool ──────────────────────────────────────────────────────

function toolSemanticSearch(query: string, topK: number, workspace: string): ToolResult {
  const results = bm25Search(query, workspace, topK)
  if (results.length === 0) {
    return {
      output: 'No results found. The codebase may not be indexed yet — ask the user to build the semantic index in Settings.',
      isError: false
    }
  }
  const lines = results.map((r, i) =>
    `${i + 1}. ${r.path}  (lines ${r.startLine}–${r.endLine}, score ${r.score.toFixed(2)})\n${r.excerpt}\n`
  )
  return { output: `Top ${results.length} results for "${query}":\n\n${lines.join('\n')}`, isError: false }
}

// ── Public dispatcher ─────────────────────────────────────────────────────────

async function runDocker(
  image: string,
  command: string,
  workspace: string,
  onOutputChunk?: (chunk: string) => void
): Promise<ToolResult> {
  // Check if docker is available
  const { execSync: _exec } = await import('child_process')
  try { _exec('docker --version', { stdio: 'ignore' }) }
  catch { return { output: 'Docker is not installed or not in PATH.', isError: true } }
  // Run in container with workspace mounted
  const safe = workspace.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
  const fullCmd = `docker run --rm -v "${workspace}:/workspace" -w /workspace ${image} ${command}`
  return runCommand(fullCmd, workspace, onOutputChunk)
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  workspacePath: string,
  onDiffRequest?: DiffApprovalFn,
  onOutputChunk?: (chunk: string) => void,
  braveApiKey?: string
): Promise<ToolResult> {
  // Check disabled tools first (set by project config)
  if (_disabledTools.has(name)) {
    return {
      output: `Tool "${name}" is disabled for this workspace by the .chatui project config.`,
      isError: true
    }
  }

  // Web tools don't need a workspace
  if (name === 'fetch_url') return fetchUrl(input.url as string)
  if (name === 'web_search') return webSearch(input.query as string, braveApiKey ?? '')

  if (!workspacePath) {
    return {
      output: 'No workspace configured. Open Settings and set a Workspace Folder to enable file operations.',
      isError: true
    }
  }

  try {
    switch (name) {
      case 'read_file':
        return readFile(input.path as string, workspacePath)
      case 'read_file_range':
        return readFileRange(input.path as string, input.start_line as number, input.end_line as number, workspacePath)
      case 'str_replace':
        return strReplace(input.path as string, input.old_str as string, input.new_str as string, workspacePath, onDiffRequest)
      case 'write_file':
        return writeFile(input.path as string, input.content as string, workspacePath, onDiffRequest)
      case 'list_directory':
        return listDirectory((input.path as string) || '.', workspacePath)
      case 'search_files':
        return searchFiles(input.pattern as string, (input.path as string) || '.', workspacePath)
      case 'run_command':
        return runCommand(input.command as string, workspacePath, onOutputChunk)
      case 'git_status':
        return toolGitStatus(workspacePath)
      case 'git_diff':
        return toolGitDiff(!!(input.staged), input.path as string | undefined, workspacePath)
      case 'git_log':
        return toolGitLog((input.count as number) ?? 10, workspacePath)
      case 'git_add':
        return toolGitAdd(input.paths as string[], workspacePath)
      case 'git_commit':
        return toolGitCommit(input.message as string, workspacePath)
      case 'semantic_search':
        return toolSemanticSearch(input.query as string, (input.top_k as number) ?? 5, workspacePath)
      case 'remember':
        return rememberNote(input.note as string, workspacePath)
      case 'remember_globally':
        return rememberGlobally(input.note as string)
      case 'write_plan':
        return writePlan(input.plan as string, workspacePath)
      case 'update_project_summary':
        return updateProjectSummary(input.content as string, workspacePath)
      case 'query_database': {
        const connStr = (input.connection_string as string) || ''
        const sql     = (input.sql as string) || ''
        return queryDatabase(connStr, sql, workspacePath)
      }
      case 'browser_navigate':
        return browserNavigate(input.url as string)
      case 'browser_click':
        return browserClick(input.selector as string)
      case 'browser_fill':
        return browserFill(input.selector as string, input.value as string)
      case 'browser_get_text':
        return browserGetText(input.selector as string | undefined)
      case 'browser_screenshot':
        return browserScreenshot()
      case 'browser_eval':
        return browserEval(input.script as string)
      case 'browser_close':
        return browserClose()
      case 'run_docker':
        return runDocker(input.image as string, input.command as string, workspacePath, onOutputChunk)
      default: {
        // Check custom plugins loaded from .ai-context/tools/
        const plugin = _customPlugins.find(p => p.name === name)
        if (plugin) {
          const result = await plugin.execute(input)
          if (typeof result === 'string') return { output: result, isError: false }
          return result
        }
        return { output: `Unknown tool: ${name}`, isError: true }
      }
    }
  } catch (err) {
    return {
      output: `Tool "${name}" error: ${err instanceof Error ? err.message : String(err)}`,
      isError: true
    }
  }
}

// ── Anthropic tool definitions (JSON Schema) ──────────────────────────────────

export const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description:
      'Read the full contents of a file with line numbers. ' +
      'Lines are prefixed "  42 | code" so you can reference exact line numbers. ' +
      'Always read a file before editing it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root, e.g. "src/index.ts" or "README.md"'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'read_file_range',
    description:
      'Read a specific range of lines from a file (with line numbers). ' +
      'Use this instead of read_file when you only need part of a large file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path:       { type: 'string', description: 'File path relative to workspace root' },
        start_line: { type: 'number', description: 'First line to read (1-indexed)' },
        end_line:   { type: 'number', description: 'Last line to read (inclusive)' }
      },
      required: ['path', 'start_line', 'end_line']
    }
  },
  {
    name: 'str_replace',
    description:
      'Make a surgical edit to a file by replacing an exact string with new content. ' +
      'PREFER this over write_file for modifying existing files — it is safer and faster. ' +
      'The old_str must match the file EXACTLY (including indentation and whitespace) and must be unique. ' +
      'If the match is ambiguous, add more surrounding lines to make it unique. ' +
      'After editing, the file is automatically re-read to verify the change.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path:    { type: 'string', description: 'File path relative to workspace root' },
        old_str: { type: 'string', description: 'The exact text to replace. Must appear exactly once in the file.' },
        new_str: { type: 'string', description: 'The new text to put in place of old_str.' }
      },
      required: ['path', 'old_str', 'new_str']
    }
  },
  {
    name: 'write_file',
    description:
      'Write content to a file, creating it (and any missing parent directories) if needed. ' +
      'This OVERWRITES the entire file. ' +
      'Use str_replace for modifying existing files — only use write_file for new files or complete rewrites.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root'
        },
        content: {
          type: 'string',
          description: 'Full file content to write'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_directory',
    description:
      'List all files and subdirectories at a given path. ' +
      'Start with "." to get the workspace root overview.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to the workspace root. Defaults to "." (workspace root).'
        }
      },
      required: []
    }
  },
  {
    name: 'search_files',
    description:
      'Search for a text pattern across all files in the workspace (like grep). ' +
      'Returns matching lines with file path and line number. ' +
      'Skips node_modules, .git, dist, and other noise directories.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression or literal text to search for'
        },
        path: {
          type: 'string',
          description: 'Directory to search in (relative to workspace root). Defaults to "." (everywhere).'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'run_command',
    description:
      'Execute a shell command in the workspace directory. ' +
      'Use for running tests, installing packages, building, linting, etc. ' +
      'Commands run in the workspace root by default. Has a 30-second timeout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The shell command to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'git_status',
    description:
      'Show the current git status: branch name, staged changes, unstaged changes, ' +
      'untracked files, and ahead/behind count vs remote. ' +
      'Always call this before making changes to understand the current state.',
    input_schema: { type: 'object' as const, properties: {}, required: [] }
  },
  {
    name: 'git_diff',
    description:
      'Show the git diff — what has changed but not yet committed. ' +
      'Use staged=true to see staged (index) changes, staged=false for unstaged working tree changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        staged: {
          type: 'boolean',
          description: 'true = show staged diff (index vs HEAD), false = show unstaged diff (working tree vs index)'
        },
        path: {
          type: 'string',
          description: 'Optional: limit diff to a specific file path'
        }
      },
      required: []
    }
  },
  {
    name: 'git_log',
    description: 'Show recent commit history with hashes, messages, authors, and dates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        count: {
          type: 'number',
          description: 'Number of commits to show (default 10, max 50)'
        }
      },
      required: []
    }
  },
  {
    name: 'git_add',
    description:
      'Stage files for commit (like `git add`). ' +
      'Call this before git_commit. Use ["."] to stage all changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths to stage. Use ["."] for all changes.'
        }
      },
      required: ['paths']
    }
  },
  {
    name: 'git_commit',
    description:
      'Commit staged changes with a message. ' +
      'Always call git_add first to stage the files you want to commit. ' +
      'Write clear, descriptive commit messages.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The commit message, e.g. "feat: add user authentication"'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'semantic_search',
    description:
      'Search the codebase by meaning / concept rather than exact text. ' +
      'Returns the most relevant file sections ranked by relevance score. ' +
      'Use this when you need to find code related to a concept, feature, or question ' +
      'and don\'t know the exact file or function name. ' +
      'Requires the semantic index to be built (users can do this in Settings).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of what you are looking for, e.g. "authentication middleware" or "database connection pooling"'
        },
        top_k: {
          type: 'number',
          description: 'Number of results to return (default 5, max 10)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'remember',
    description:
      'Save an important fact about this project to persistent memory. ' +
      'The note will be automatically injected into every future conversation in this workspace, ' +
      'so the AI always knows it without being told again. ' +
      'Use this when the user shares preferences, constraints, architectural decisions, ' +
      'conventions, or any fact that should persist across sessions. ' +
      'Examples: "We use PostgreSQL not MySQL", "Deploy target is Railway", ' +
      '"Always write tests with Vitest", "The lead developer prefers functional React patterns".',
    input_schema: {
      type: 'object' as const,
      properties: {
        note: {
          type: 'string',
          description: 'The fact or preference to remember, written as a clear concise statement'
        }
      },
      required: ['note']
    }
  },
  {
    name: 'fetch_url',
    description:
      'Fetch the content of any URL and return it as readable text. ' +
      'Use this when the user pastes a link, references documentation, or asks about a webpage. ' +
      'Automatically strips HTML tags and extracts the main content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The full URL to fetch (must start with http:// or https://)' }
      },
      required: ['url']
    }
  },
  {
    name: 'web_search',
    description:
      'Search the web for current information, documentation, error messages, or anything not in the codebase. ' +
      'Returns a list of relevant results with titles, URLs, and descriptions. ' +
      'Use fetch_url on specific results to read their full content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'remember_globally',
    description:
      'Save an important fact that applies to ALL projects and ALL future conversations — not just this workspace. ' +
      'Use this for preferences, habits, or constraints that should follow the user everywhere: ' +
      '"I prefer Tailwind over plain CSS", "Always use TypeScript strict mode", ' +
      '"My name is Alex", "I deploy to Vercel". ' +
      'Use the regular remember tool for project-specific facts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        note: {
          type: 'string',
          description: 'The global preference or fact to remember, as a clear concise statement'
        }
      },
      required: ['note']
    }
  },
  {
    name: 'write_plan',
    description:
      'Write out your step-by-step plan BEFORE making any edits when a task touches multiple files. ' +
      'List every file you will modify and exactly what you will do to each one. ' +
      'This forces a full-picture review before any code changes and helps catch conflicts early. ' +
      'Call this as your FIRST action on any multi-file task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        plan: {
          type: 'string',
          description:
            'Markdown-formatted plan. For each file: filename, what will change, and why. ' +
            'Also note any shared types, interfaces, or contracts that must stay consistent.'
        }
      },
      required: ['plan']
    }
  },
  {
    name: 'update_project_summary',
    description:
      'Save a comprehensive PROJECT.md summary to .ai-context/PROJECT.md in the workspace. ' +
      'Call this after completing any significant coding task so the project state is always documented. ' +
      'The summary lets any developer or AI tool (Claude, Cursor, ChatGPT, Codex, etc.) instantly ' +
      'understand the project and continue work without scanning all files. ' +
      'Always overwrite with a fully up-to-date version — do not append.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description:
            'Full markdown content for PROJECT.md. Must include: ' +
            'project overview (2–3 sentences), tech stack, architecture, ' +
            'key files table, conventions/patterns, recent session changes, ' +
            'and anything in progress or known issues.'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'query_database',
    description:
      'Run a SQL query against a SQLite (.db/.sqlite file path) or PostgreSQL database (postgres:// URL). ' +
      'Returns results as a markdown table. Read-only queries are safest; write queries are also supported.',
    input_schema: {
      type: 'object' as const,
      properties: {
        connection_string: {
          type: 'string',
          description: 'SQLite: path like "db/app.sqlite" | PostgreSQL: "postgres://user:pass@host:5432/db"'
        },
        sql: { type: 'string', description: 'The SQL query to execute' }
      },
      required: ['connection_string', 'sql']
    }
  },
  {
    name: 'browser_navigate',
    description: 'Open a URL in a headless Chromium browser. Returns page title and HTTP status.',
    input_schema: {
      type: 'object' as const,
      properties: { url: { type: 'string', description: 'Full URL to navigate to' } },
      required: ['url']
    }
  },
  {
    name: 'browser_click',
    description: 'Click an element on the current browser page using a CSS selector.',
    input_schema: {
      type: 'object' as const,
      properties: { selector: { type: 'string', description: 'CSS selector of element to click' } },
      required: ['selector']
    }
  },
  {
    name: 'browser_fill',
    description: 'Fill a form input on the current browser page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of input element' },
        value:    { type: 'string', description: 'Value to type into the field' }
      },
      required: ['selector', 'value']
    }
  },
  {
    name: 'browser_get_text',
    description: 'Get the text content of the current browser page or a specific element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector — omit to get full page text' }
      },
      required: []
    }
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current browser page. Returns the file path.',
    input_schema: { type: 'object' as const, properties: {}, required: [] }
  },
  {
    name: 'run_docker',
    description:
      'Run a command inside a Docker container with the workspace mounted at /workspace. ' +
      'Safer than run_command for untrusted code. Requires Docker to be installed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image:   { type: 'string', description: 'Docker image, e.g. "node:20-alpine" or "python:3.12-slim"' },
        command: { type: 'string', description: 'Command to run inside the container' }
      },
      required: ['image', 'command']
    }
  },
]
