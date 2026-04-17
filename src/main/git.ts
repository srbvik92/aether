/**
 * Git integration module.
 *
 * Provides:
 *   - gitStatus()     — parsed working tree status (branch, staged, unstaged, untracked)
 *   - gitDiff()       — diff output (staged or unstaged)
 *   - gitLog()        — recent commit history
 *   - gitAdd()        — stage files
 *   - gitCommit()     — commit staged changes
 *   - isGitRepo()     — check if workspace is a git repo
 *   - buildGitSummary() — compact text block for system prompt injection
 *
 * All functions take workspacePath and run git in that directory.
 * Errors are returned as { ok: false, error } — never thrown.
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join as pathJoin } from 'path'

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_DIFF_CHARS = 40_000

function runGit(args: string, cwd: string): { out: string; err: string; ok: boolean } {
  try {
    const out = execSync(`git ${args}`, {
      cwd,
      timeout: 15_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { out: out.trim(), err: '', ok: true }
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string }
    return { out: '', err: (err.stderr ?? err.message ?? String(e)).trim(), ok: false }
  }
}

function cap(text: string, max = MAX_DIFF_CHARS): string {
  if (text.length <= max) return text
  const half = max / 2
  return text.slice(0, half) + `\n\n[... truncated ${text.length - max} chars ...]\n\n` + text.slice(-half)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isGitRepo(workspacePath: string): boolean {
  if (!workspacePath) return false
  return existsSync(pathJoin(workspacePath, '.git'))
}

// ── Structured status ─────────────────────────────────────────────────────────

export interface GitFileStatus {
  path:       string
  status:     string   // 'M' | 'A' | 'D' | 'R' | '??' | etc.
  staged:     boolean
  description: string
}

export interface GitStatus {
  branch:     string
  upstream:   string | null    // e.g. "origin/main"
  ahead:      number
  behind:     number
  staged:     GitFileStatus[]
  unstaged:   GitFileStatus[]
  untracked:  GitFileStatus[]
  isClean:    boolean
}

const STATUS_DESC: Record<string, string> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed',
  C: 'copied',   U: 'updated (merge conflict)', '??': 'untracked'
}

export function getGitStatus(workspacePath: string): GitStatus | null {
  if (!isGitRepo(workspacePath)) return null

  // Branch name
  const branchResult = runGit('rev-parse --abbrev-ref HEAD', workspacePath)
  const branch = branchResult.ok ? branchResult.out : 'unknown'

  // Upstream tracking branch
  const upstreamResult = runGit(`rev-parse --abbrev-ref --symbolic-full-name @{u}`, workspacePath)
  const upstream = upstreamResult.ok ? upstreamResult.out : null

  // Ahead/behind counts
  let ahead = 0, behind = 0
  if (upstream) {
    const countResult = runGit(`rev-list --left-right --count HEAD...${upstream}`, workspacePath)
    if (countResult.ok) {
      const parts = countResult.out.split(/\s+/)
      ahead  = parseInt(parts[0] ?? '0', 10)
      behind = parseInt(parts[1] ?? '0', 10)
    }
  }

  // Porcelain status
  const statusResult = runGit('status --porcelain=v1', workspacePath)
  if (!statusResult.ok) return null

  const staged: GitFileStatus[]    = []
  const unstaged: GitFileStatus[]  = []
  const untracked: GitFileStatus[] = []

  const lines = statusResult.out ? statusResult.out.split('\n') : []

  for (const line of lines) {
    if (line.length < 2) continue
    const x = line[0]  // staged state
    const y = line[1]  // unstaged state
    const path = line.slice(3).trim()

    if (x === '?' && y === '?') {
      untracked.push({ path, status: '??', staged: false, description: 'untracked' })
      continue
    }

    if (x !== ' ' && x !== '?') {
      staged.push({
        path, status: x, staged: true,
        description: STATUS_DESC[x] ?? x
      })
    }
    if (y !== ' ' && y !== '?') {
      unstaged.push({
        path, status: y, staged: false,
        description: STATUS_DESC[y] ?? y
      })
    }
  }

  return {
    branch, upstream, ahead, behind,
    staged, unstaged, untracked,
    isClean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0
  }
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export function getGitDiff(
  workspacePath: string,
  options: { staged?: boolean; path?: string; commit?: string } = {}
): string {
  if (!isGitRepo(workspacePath)) return 'Not a git repository.'

  let args = 'diff'
  if (options.staged)  args += ' --staged'
  if (options.commit)  args += ` ${options.commit}`
  if (options.path)    args += ` -- ${options.path}`

  // Limit diff size with --stat first, then full diff
  const statResult = runGit(`${args} --stat`, workspacePath)
  const fullResult = runGit(args, workspacePath)

  if (!fullResult.ok) return fullResult.err || 'No diff available.'
  if (!fullResult.out) return options.staged ? 'No staged changes.' : 'No unstaged changes.'

  const stat = statResult.ok ? `\n${statResult.out}\n\n` : ''
  return cap(stat + fullResult.out)
}

// ── Log ───────────────────────────────────────────────────────────────────────

export function getGitLog(workspacePath: string, count = 10): string {
  if (!isGitRepo(workspacePath)) return 'Not a git repository.'

  const result = runGit(
    `log --oneline --graph --decorate --format="%h %s (%an, %ar)" -n ${count}`,
    workspacePath
  )
  return result.ok ? (result.out || 'No commits yet.') : result.err
}

// ── Stage files ───────────────────────────────────────────────────────────────

export function gitAdd(workspacePath: string, paths: string[]): { ok: boolean; output: string } {
  if (!isGitRepo(workspacePath)) return { ok: false, output: 'Not a git repository.' }

  const escaped = paths.map(p => `"${p}"`).join(' ')
  const result  = runGit(`add ${escaped}`, workspacePath)
  return {
    ok:     result.ok,
    output: result.ok ? `Staged: ${paths.join(', ')}` : result.err
  }
}

// ── Commit ────────────────────────────────────────────────────────────────────

export function gitCommit(workspacePath: string, message: string): { ok: boolean; output: string } {
  if (!isGitRepo(workspacePath)) return { ok: false, output: 'Not a git repository.' }
  if (!message.trim()) return { ok: false, output: 'Commit message cannot be empty.' }

  // Check there's something staged
  const status = getGitStatus(workspacePath)
  if (status && status.staged.length === 0) {
    return { ok: false, output: 'Nothing staged to commit. Use git_add first.' }
  }

  const result = runGit(`commit -m "${message.replace(/"/g, '\\"')}"`, workspacePath)
  return {
    ok:     result.ok,
    output: result.ok ? result.out : result.err
  }
}

// ── Compact summary for system prompt injection ───────────────────────────────

export function buildGitSummary(workspacePath: string): string {
  const status = getGitStatus(workspacePath)
  if (!status) return ''

  const lines: string[] = []

  // Branch line
  let branchLine = `**Branch:** ${status.branch}`
  if (status.upstream) {
    if (status.ahead > 0 || status.behind > 0) {
      branchLine += ` (↑${status.ahead} ahead, ↓${status.behind} behind ${status.upstream})`
    } else {
      branchLine += ` (up to date with ${status.upstream})`
    }
  }
  lines.push(branchLine)

  if (status.isClean) {
    lines.push('**Working tree:** clean')
  } else {
    if (status.staged.length > 0) {
      lines.push(`**Staged (${status.staged.length}):** ${status.staged.map(f => `${f.description} ${f.path}`).join(', ')}`)
    }
    if (status.unstaged.length > 0) {
      lines.push(`**Unstaged (${status.unstaged.length}):** ${status.unstaged.map(f => `${f.description} ${f.path}`).join(', ')}`)
    }
    if (status.untracked.length > 0) {
      const shown = status.untracked.slice(0, 10)
      lines.push(`**Untracked (${status.untracked.length}):** ${shown.map(f => f.path).join(', ')}${status.untracked.length > 10 ? '…' : ''}`)
    }
  }

  // Recent commits
  const log = getGitLog(workspacePath, 5)
  if (log && log !== 'No commits yet.') {
    lines.push('', '**Recent commits:**', '```', log, '```')
  }

  lines.push('', 'Use git_status, git_diff, git_log, git_add, and git_commit tools for git operations.')

  return lines.join('\n')
}
