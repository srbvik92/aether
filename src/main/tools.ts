/**
 * Tool definitions and executors for the AI agent loop.
 *
 * Safety rules enforced here:
 *   - All file paths are resolved against the workspace root
 *   - Paths escaping the workspace are rejected (path-traversal protection)
 *   - Shell commands have a 30-second hard timeout
 *   - Tool output is capped at MAX_OUTPUT_CHARS to avoid flooding the context window
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, unlinkSync, renameSync, rmdirSync } from 'fs'
import { join, resolve, relative, dirname, basename } from 'path'
import { spawn } from 'child_process'
import { net } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import { getGitStatus, getGitDiff, getGitLog, gitAdd, gitCommit, isGitRepo } from './git'
import { bm25Search } from './semantic-search'
import { queryDatabase } from './db-tool'
import {
  browserNavigate, browserClick, browserFill,
  browserGetText, browserScreenshot, browserEval, browserClose
} from './browser-tool'

// Callback that pauses the agent and asks the user to approve a file write.
// Returns false if rejected, or the string content to write if approved
// (may differ from `after` when the user accepted only some hunks).
export type DiffApprovalFn = (
  path: string,
  before: string,
  after: string,
  isNew: boolean
) => Promise<string | false>

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
      const result = await onDiffRequest(filePath, before, after, false)
      if (result === false) {
        return { output: `Edit to "${filePath}" was rejected by the user.`, isError: false }
      }
      writeFileSync(abs, result, 'utf-8')
    } else {
      writeFileSync(abs, after, 'utf-8')
    }
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
    const result = await onDiffRequest(filePath, before, content, isNew)
    if (result === false) {
      return {
        output: `Write to "${filePath}" was rejected by the user. Do not retry this write unless the user asks you to.`,
        isError: false
      }
    }
    const dir = dirname(abs)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(abs, result, 'utf-8')
    return {
      output: isNew
        ? `Created ${filePath} (${result.length} chars)`
        : `Updated ${filePath} (${result.length} chars)`,
      isError: false
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

// ── delete_file ───────────────────────────────────────────────────────────────
async function deleteFile(
  filePath: string,
  workspace: string,
  onDiffRequest?: DiffApprovalFn
): Promise<ToolResult> {
  const abs = safePath(workspace, filePath)
  if (!existsSync(abs)) return { output: `File not found: ${filePath}`, isError: true }

  const stat = statSync(abs)
  if (stat.isDirectory()) {
    // Only allow deleting empty directories via this tool
    const entries = readdirSync(abs)
    if (entries.length > 0) {
      return {
        output: `"${filePath}" is a non-empty directory. Use run_command to delete directories with contents.`,
        isError: true
      }
    }
  }

  // Show the file contents as a "deletion diff" — before = content, after = empty
  if (onDiffRequest) {
    const before = stat.isDirectory() ? '(empty directory)' : (() => {
      try { return readFileSync(abs, 'utf-8') } catch { return '(binary file)' }
    })()
    const result = await onDiffRequest(filePath, before, '', false)
    if (result === false) {
      return { output: `Deletion of "${filePath}" was rejected by the user.`, isError: false }
    }
  }

  if (stat.isDirectory()) {
    rmdirSync(abs)
  } else {
    unlinkSync(abs)
  }
  return { output: `Deleted ${filePath}`, isError: false }
}

// ── rename_file ───────────────────────────────────────────────────────────────
async function renameFile(
  oldPath: string,
  newPath: string,
  workspace: string,
  onDiffRequest?: DiffApprovalFn
): Promise<ToolResult> {
  const absOld = safePath(workspace, oldPath)
  const absNew = safePath(workspace, newPath)

  if (!existsSync(absOld)) return { output: `File not found: ${oldPath}`, isError: true }
  if (existsSync(absNew))  return { output: `Destination already exists: ${newPath}. Choose a different name.`, isError: true }

  // Show as a diff: before = "Rename: old → new\n<content>", after = same content at new path
  if (onDiffRequest) {
    const content = (() => { try { return readFileSync(absOld, 'utf-8') } catch { return '(binary file)' } })()
    const before  = `// RENAME: ${oldPath}\n${content}`
    const after   = `// RENAME TO: ${newPath}\n${content}`
    const result = await onDiffRequest(oldPath, before, after, false)
    if (result === false) {
      return { output: `Rename of "${oldPath}" was rejected by the user.`, isError: false }
    }
  }

  const destDir = dirname(absNew)
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  renameSync(absOld, absNew)
  return { output: `Renamed ${oldPath} → ${newPath}`, isError: false }
}

// ── move_file ─────────────────────────────────────────────────────────────────
async function moveFile(
  sourcePath: string,
  destPath: string,
  workspace: string,
  onDiffRequest?: DiffApprovalFn
): Promise<ToolResult> {
  const absSrc  = safePath(workspace, sourcePath)
  const absDest = safePath(workspace, destPath)

  if (!existsSync(absSrc)) return { output: `Source not found: ${sourcePath}`, isError: true }

  // If dest is an existing directory, move into it
  let finalDest = absDest
  if (existsSync(absDest) && statSync(absDest).isDirectory()) {
    finalDest = join(absDest, basename(absSrc))
  }
  const finalRelative = relative(workspace, finalDest)

  if (existsSync(finalDest)) {
    return { output: `Destination already exists: ${finalRelative}. Delete it first or use a different destination.`, isError: true }
  }

  if (onDiffRequest) {
    const content = (() => { try { return readFileSync(absSrc, 'utf-8') } catch { return '(binary file)' } })()
    const before  = `// MOVE FROM: ${sourcePath}\n${content}`
    const after   = `// MOVE TO: ${finalRelative}\n${content}`
    const result = await onDiffRequest(sourcePath, before, after, false)
    if (result === false) {
      return { output: `Move of "${sourcePath}" was rejected by the user.`, isError: false }
    }
  }

  const destDir = dirname(finalDest)
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  renameSync(absSrc, finalDest)
  return { output: `Moved ${sourcePath} → ${finalRelative}`, isError: false }
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
  onChunk?: (chunk: string) => void,
  callId?: string
): Promise<ToolResult> {
  if (!workspace) {
    return Promise.resolve({ output: 'No workspace set — cannot run commands without a workspace directory.', isError: true })
  }

  // ── Approval gate ─────────────────────────────────────────────────────────
  const dangerous = isDangerousCommand(command)
  const cmdLower  = command.trim().toLowerCase()
  const trusted   = !dangerous && (
    _trustedCommands.some(t => cmdLower.startsWith(t.toLowerCase()))
  )

  if (!trusted && _cmdApprovalFn) {
    return (_cmdApprovalFn as (c: string, w: string, d: boolean, id?: string) => Promise<boolean>)(command, workspace, dangerous, callId).then(approved => {
      if (!approved) {
        return { output: 'Command was not approved by the user. Do not retry this command unless the user explicitly asks.', isError: false }
      }
      return runCommandImpl(command, workspace, onChunk, callId)
    })
  }

  return runCommandImpl(command, workspace, onChunk, callId)
}

// ── Running process registry (for kill support) ───────────────────────────────
import type { ChildProcess } from 'child_process'
const _runningProcesses = new Map<string, ChildProcess>()
// Track IDs that were explicitly killed by the user so the close handler can
// distinguish a user-kill from a natural exit (Windows signal is always null).
const _userKilledIds = new Set<string>()

/** Kill a running shell command by its tool call ID. Returns true if found. */
export function killRunningCommand(callId: string): boolean {
  const child = _runningProcesses.get(callId)
  if (!child) return false
  _userKilledIds.add(callId)      // mark BEFORE deleting so close handler sees it
  _runningProcesses.delete(callId)
  try {
    if (process.platform === 'win32' && child.pid) {
      // taskkill /T kills the whole process tree (PowerShell + any child procs)
      const { execSync } = require('child_process') as typeof import('child_process')
      try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }) } catch { /* already gone */ }
    } else {
      child.kill('SIGTERM')
      // Escalate to SIGKILL after 1 s if the process didn't exit cleanly
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already dead */ } }, 1000)
    }
  } catch { /* already dead */ }
  return true
}

function runCommandImpl(
  command: string,
  workspace: string,
  onChunk?: (chunk: string) => void,
  callId?: string
): Promise<ToolResult> {
  return new Promise((resolve) => {
    // Force line-buffered / verbose output so tools don't silently buffer
    const extraEnv: Record<string, string> = {
      // npm: disable progress bar, enable http-level logging so installs show activity
      npm_config_progress:    'false',
      npm_config_loglevel:    'http',
      // Python: disable output buffering
      PYTHONUNBUFFERED:       '1',
      // Generic: no colour (avoids ANSI noise in the output pane)
      NO_COLOR:               '1',
      FORCE_COLOR:            '0',
      // Windows: ensure child processes inherit PATH properly
      ...(process.platform === 'win32' ? { PATHEXT: process.env.PATHEXT ?? '' } : {})
    }

    // On Windows: spawn PowerShell directly so that PS cmdlets (New-Item,
    // Remove-Item, $env:VAR, etc.) work and so the process can be killed cleanly.
    // On macOS/Linux: use the default shell via shell:true.
    const child = process.platform === 'win32'
      ? spawn('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy', 'Bypass',
          '-Command', command
        ], {
          cwd:   workspace,
          stdio: ['ignore', 'pipe', 'pipe'],
          env:   { ...process.env, ...extraEnv }
        })
      : spawn(command, {
          cwd:   workspace,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env:   { ...process.env, ...extraEnv }
        })

    // Register so it can be killed externally
    if (callId) _runningProcesses.set(callId, child)

    let combined = ''
    let killedByUser = false

    const handleData = (data: Buffer) => {
      const chunk = data.toString('utf-8')
      combined += chunk
      onChunk?.(chunk)
    }

    child.stdout.on('data', handleData)
    child.stderr.on('data', handleData)

    // Use a longer timeout for package manager / build commands that can be slow
    const isSlowCommand = /\b(npm|yarn|pnpm|bun)\s+(install|i|ci|build|run|add|remove|update)\b/i.test(command)
      || /\b(pip|pip3|cargo|go get|go build|mvn|gradle|composer)\b/i.test(command)
      || /\b(npx|bunx)\b/i.test(command)
    const timeoutMs = isSlowCommand ? 300_000 : 30_000  // 5 min for slow, 30s otherwise
    const timeoutLabel = isSlowCommand ? '5 min' : '30s'

    const timer = setTimeout(() => {
      if (callId) _runningProcesses.delete(callId)
      child.kill('SIGKILL')
      resolve({
        output:  cap((combined.trim() || '(no output)') + `\n\n[timed out after ${timeoutLabel}]`),
        isError: true
      })
    }, timeoutMs)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (callId) _runningProcesses.delete(callId)

      // Killed by user via killRunningCommand():
      // On Unix the signal is SIGTERM/SIGKILL; on Windows signal is always null
      // after taskkill, so we track kills in _userKilledIds instead.
      const wasUserKilled = (callId ? _userKilledIds.delete(callId) : false)
        || signal === 'SIGTERM'
        || signal === 'SIGKILL'
      killedByUser = wasUserKilled
      if (wasUserKilled) {
        return resolve({
          output: cap((combined.trim() || '(no output)') + '\n\n[Command was stopped by the user.]'),
          isError: false
        })
      }

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
      if (callId) _runningProcesses.delete(callId)
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
  if (!url?.trim()) {
    return { output: 'fetch_url requires a URL. Provide the full URL including https://', isError: true }
  }
  try { new URL(url) } catch {
    return { output: `Invalid URL: ${JSON.stringify(url)}. Must be a full URL starting with https://`, isError: true }
  }
  const content = await fetchPageContent(url)
  if (content === null) {
    return { output: `Could not fetch ${url} — the site may be down or blocking automated requests.`, isError: true }
  }
  return { output: `[Fetched: ${url}]\n\n${content}`, isError: false }
}

/** Fetch a URL and return cleaned text — shared by webSearch, fetch_url, and URL pre-fetch IPC */
export async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const res = await net.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Coding-Assistant/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const ct  = res.headers.get('content-type') ?? ''
    const raw = await res.text()
    if (ct.includes('text/html')) {
      const titleM = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const title  = titleM ? stripHtml(titleM[1]).trim() : ''
      const mainM  = raw.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i)
      const body   = stripHtml(mainM ? mainM[1] : raw).trim()
      const text   = (title ? `# ${title}\n\n` : '') + body
      return text.length > 12_000 ? text.slice(0, 12_000) + '\n[...truncated]' : text
    }
    return raw.length > 12_000 ? raw.slice(0, 12_000) + '\n[...truncated]' : raw
  } catch {
    return null
  }
}

async function webSearch(query: string, apiKey: string): Promise<ToolResult> {
  if (!query?.trim()) {
    return { output: 'web_search requires a query — the query argument was empty or missing.', isError: true }
  }
  if (!apiKey?.trim()) {
    return {
      output: 'Web search requires a Brave Search API key.\nAdd it in Settings → Web Search → Brave API Key.\nGet a free key at https://brave.com/search/api/ (2,000 queries/month free).',
      isError: true
    }
  }

  try {
    const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&text_decorations=false`
    const response = await net.fetch(searchUrl, {
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

    // Build the results list
    const lines = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.description ?? ''}`
    ).join('\n\n')

    // Automatically fetch and inline content from the top 2 results so the AI
    // does not need a separate fetch_url call (same pattern as Claude web search)
    const topTwo = results.slice(0, 2)
    const fetched = await Promise.all(
      topTwo.map(async r => {
        const content = await fetchPageContent(r.url)
        return content
          ? `\n\n---\n### Full content: ${r.title}\nURL: ${r.url}\n\n${content}\n---`
          : null
      })
    )
    const inlined = fetched.filter(Boolean).join('')

    const out = `Web search results for "${query}":\n\n${lines}${inlined}`
    return { output: out, isError: false }
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
  braveApiKey?: string,
  callId?: string
): Promise<ToolResult> {
  // Check disabled tools first (set by project config)
  if (_disabledTools.has(name)) {
    return {
      output: `Tool "${name}" is disabled for this workspace by the .chatui project config.`,
      isError: true
    }
  }

  // Web tools don't need a workspace
  if (name === 'fetch_url') {
    const url = (input.url ?? input.URL ?? input.uri ?? '') as string
    return fetchUrl(url)
  }
  if (name === 'web_search') {
    const query = (input.query ?? input.q ?? input.search_query ?? '') as string
    return webSearch(query, braveApiKey ?? '')
  }

  if (!workspacePath) {
    return {
      output: 'No workspace configured. Open Settings and set a Workspace Folder to enable file operations.',
      isError: true
    }
  }

  // Fuzzy argument resolver — AI models (especially GPT) sometimes use different
  // key names than the schema specifies. Try common aliases before giving up.
  const p  = (input.path ?? input.file ?? input.filename ?? input.filepath ?? input.file_path ?? '') as string
  const p2 = (input.new_path ?? input.dest ?? input.destination ?? input.dest_path ?? '') as string
  const cmd = (input.command ?? input.cmd ?? input.run ?? input.script ?? '') as string

  // Guards: required args must be non-empty — return clean errors instead of crashing
  const FILE_TOOLS = ['read_file','read_file_range','write_file','str_replace','delete_file','rename_file','move_file']
  if (FILE_TOOLS.includes(name) && !p?.trim()) {
    return { output: `Tool "${name}" requires a "path" argument — none was provided. Call the tool again with path set to the file you want to operate on.`, isError: true }
  }
  if (name === 'run_command' && !cmd?.trim()) {
    return { output: 'Tool "run_command" requires a "command" argument — none was provided. Call the tool again with command set to the shell command you want to run.', isError: true }
  }

  try {
    switch (name) {
      case 'read_file':
        return readFile(p, workspacePath)
      case 'read_file_range':
        return readFileRange(p, input.start_line as number, input.end_line as number, workspacePath)
      case 'str_replace':
        return strReplace(p, input.old_str as string, input.new_str as string, workspacePath, onDiffRequest)
      case 'write_file':
        return writeFile(p, input.content as string, workspacePath, onDiffRequest)
      case 'list_directory':
        return listDirectory(p || '.', workspacePath)
      case 'search_files':
        return searchFiles(input.pattern as string, p || '.', workspacePath)
      case 'run_command':
        return runCommand(cmd, workspacePath, onOutputChunk, callId)
      case 'git_status':
        return toolGitStatus(workspacePath)
      case 'git_diff':
        return toolGitDiff(!!(input.staged), p || undefined, workspacePath)
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
      case 'delete_file':
        return deleteFile(p, workspacePath, onDiffRequest)
      case 'rename_file':
        return renameFile((input.old_path ?? p) as string, p2, workspacePath, onDiffRequest)
      case 'move_file':
        return moveFile((input.source_path ?? input.source ?? p) as string, (input.dest_path ?? input.dest ?? p2) as string, workspacePath, onDiffRequest)
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
    description: (() => {
      const shell = process.platform === 'win32' ? 'PowerShell' : process.platform === 'darwin' ? 'zsh' : 'bash'
      const hint  = process.platform === 'win32'
        ? 'Use PowerShell syntax (not bash). E.g. `Remove-Item -Recurse` not `rm -rf`, `$env:VAR` not `$VAR`.'
        : 'Use bash/sh syntax.'
      return `Execute a shell command in the workspace root (cwd is always the workspace folder). Shell: ${shell}. ${hint} ` +
             'Do NOT cd into subdirectories — use relative paths instead. ' +
             'Timeout: 5 minutes for npm/yarn/pip/cargo/build commands, 30 seconds for everything else.'
    })(),
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
  {
    name: 'delete_file',
    description:
      'Delete a file (or empty directory) in the workspace. ' +
      'The user will see the file contents and must approve before deletion. ' +
      'Do NOT use this for directories with contents — use run_command for that. ' +
      'Prefer this over "run_command rm" so the user gets a proper approval dialog.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative path to the file to delete, e.g. "src/old-component.tsx"' }
      },
      required: ['path']
    }
  },
  {
    name: 'rename_file',
    description:
      'Rename a file or directory within the workspace. ' +
      'The user will see the old and new name and must approve. ' +
      'Use this instead of "run_command mv" so the rename goes through the proper approval flow. ' +
      'The destination must not already exist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        old_path: { type: 'string', description: 'Current relative path, e.g. "src/Button.tsx"' },
        new_path: { type: 'string', description: 'New relative path, e.g. "src/components/Button.tsx"' }
      },
      required: ['old_path', 'new_path']
    }
  },
  {
    name: 'move_file',
    description:
      'Move a file or directory to a different location in the workspace. ' +
      'The user will see the source and destination and must approve. ' +
      'Use this instead of "run_command mv" so the move goes through the proper approval flow. ' +
      'If the destination is an existing directory, the file is moved inside it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source_path: { type: 'string', description: 'Relative path of the file to move, e.g. "utils/helper.ts"' },
        dest_path:   { type: 'string', description: 'Destination path or directory, e.g. "src/utils/helper.ts"' }
      },
      required: ['source_path', 'dest_path']
    }
  },
]

// Tools that require a workspace folder — excluded from the AI's tool list when
// no folder is attached to the conversation, so the model never tries to use them.
const WORKSPACE_TOOL_NAMES = new Set([
  'read_file', 'read_file_range', 'str_replace', 'write_file',
  'list_directory', 'search_files', 'run_command', 'run_docker',
  'git_status', 'git_diff', 'git_log', 'git_add', 'git_commit',
  'semantic_search', 'remember', 'write_plan', 'update_project_summary',
  'query_database',
  'delete_file', 'rename_file', 'move_file',
])

/**
 * Returns the Anthropic tool list, filtered based on whether a workspace is set.
 * When workspacePath is empty, only web/browser tools are included.
 */
export function getAnthropicTools(workspacePath: string): Anthropic.Tool[] {
  if (workspacePath) return ANTHROPIC_TOOLS
  return ANTHROPIC_TOOLS.filter(t => !WORKSPACE_TOOL_NAMES.has(t.name))
}
