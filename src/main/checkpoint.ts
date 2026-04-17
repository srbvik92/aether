/**
 * File-based checkpoint / snapshot system.
 *
 * Before the AI modifies any file in a turn we back up its original content
 * to .ai-context/snapshots/{snapshotId}/.  The user can then restore the
 * entire session with one click.
 *
 * Works with ANY workspace — no git required.
 * If git IS available we also record the HEAD commit so the UI can show a
 * meaningful diff link in the future.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname, relative } from 'path'
import { execSync } from 'child_process'

export interface SnapshotInfo {
  id:        string    // "chatui-{timestamp}"
  timestamp: number
  fileCount: number    // number of files backed up
}

interface FileEntry {
  relativePath: string
  isNew: boolean       // true = AI created this file; restore by deleting it
}

interface Manifest {
  id:        string
  timestamp: number
  workspace: string
  gitHead?:  string    // HEAD commit hash at snapshot time (if git available)
  files:     FileEntry[]
}

// ── In-memory tracking (cleared after each turn) ─────────────────────────────
// snapshotId → Set of relative paths already backed up
const turnBackups = new Map<string, Set<string>>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function snapshotDir(workspace: string, id: string): string {
  return join(workspace, '.ai-context', 'snapshots', id)
}

function manifestPath(workspace: string, id: string): string {
  return join(snapshotDir(workspace, id), 'manifest.json')
}

function readManifest(workspace: string, id: string): Manifest | null {
  const p = manifestPath(workspace, id)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

function writeManifest(workspace: string, id: string, files: FileEntry[]): void {
  const dir = snapshotDir(workspace, id)
  mkdirSync(dir, { recursive: true })

  let gitHead: string | undefined
  try {
    gitHead = execSync('git rev-parse HEAD', { cwd: workspace, stdio: ['ignore','pipe','ignore'] })
                .toString().trim()
  } catch { /* not a git repo or no commits */ }

  const manifest: Manifest = {
    id,
    timestamp: Date.now(),
    workspace,
    gitHead,
    files,
  }
  writeFileSync(manifestPath(workspace, id), JSON.stringify(manifest, null, 2), 'utf-8')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new snapshot session and return its ID.
 * Call once per agent turn, lazily (on first file-write).
 */
export function startSnapshot(workspace: string): string {
  const id = `chatui-${Date.now()}`
  turnBackups.set(id, new Set())
  mkdirSync(snapshotDir(workspace, id), { recursive: true })
  writeManifest(workspace, id, [])
  return id
}

/**
 * Back up a file before it is written for the first time in this turn.
 * Safe to call multiple times for the same path — backs up only once.
 */
export function backupFileForSnapshot(
  workspace:    string,
  snapshotId:   string,
  relativePath: string
): void {
  const backed = turnBackups.get(snapshotId)
  if (!backed || backed.has(relativePath)) return
  backed.add(relativePath)

  const absPath  = join(workspace, relativePath)
  const isNew    = !existsSync(absPath)

  if (!isNew) {
    // File exists — copy its current content to the snapshot directory
    const content   = readFileSync(absPath, 'utf-8')
    const backupDst = join(snapshotDir(workspace, snapshotId), 'files', relativePath)
    mkdirSync(dirname(backupDst), { recursive: true })
    writeFileSync(backupDst, content, 'utf-8')
  }
  // isNew files: recorded in manifest only — restore means deleting them

  // Update manifest on disk
  const existing = readManifest(workspace, snapshotId)
  const files: FileEntry[] = existing?.files ?? []
  if (!files.find(f => f.relativePath === relativePath)) {
    files.push({ relativePath, isNew })
  }
  writeManifest(workspace, snapshotId, files)
}

/**
 * Finalise the snapshot after the turn ends.
 * Returns summary info to attach to the AI message.
 */
export function finalizeSnapshot(workspace: string, snapshotId: string): SnapshotInfo {
  const backed    = turnBackups.get(snapshotId)
  const fileCount = backed?.size ?? 0
  turnBackups.delete(snapshotId)
  return {
    id:        snapshotId,
    timestamp: parseInt(snapshotId.replace('chatui-', ''), 10),
    fileCount
  }
}

/**
 * Restore all files that were changed during the snapshot's turn.
 * Modified files → restored from backup.
 * New files (AI-created) → deleted.
 */
export function restoreSnapshot(
  workspace:  string,
  snapshotId: string
): { ok: boolean; restoredCount: number; error?: string } {
  const manifest = readManifest(workspace, snapshotId)
  if (!manifest) {
    return { ok: false, restoredCount: 0, error: 'Snapshot not found. It may have been cleared.' }
  }

  let restoredCount = 0
  const errors: string[] = []

  for (const entry of manifest.files) {
    const absPath = join(workspace, entry.relativePath)
    try {
      if (entry.isNew) {
        // AI created this file — delete it
        if (existsSync(absPath)) { unlinkSync(absPath); restoredCount++ }
      } else {
        // AI modified this file — restore the backed-up content
        const backupSrc = join(snapshotDir(workspace, snapshotId), 'files', entry.relativePath)
        if (existsSync(backupSrc)) {
          mkdirSync(dirname(absPath), { recursive: true })
          writeFileSync(absPath, readFileSync(backupSrc, 'utf-8'), 'utf-8')
          restoredCount++
        }
      }
    } catch (err) {
      errors.push(`${entry.relativePath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (errors.length > 0) {
    return { ok: false, restoredCount, error: errors.join('\n') }
  }
  return { ok: true, restoredCount }
}

/**
 * Returns the relative path from workspace, or the original path if resolution fails.
 */
export function toRelativePath(workspace: string, maybeAbsolute: string): string {
  try {
    const rel = relative(workspace, maybeAbsolute)
    // If it doesn't start with '..' it's inside the workspace
    if (!rel.startsWith('..')) return rel
  } catch { /* ignore */ }
  return maybeAbsolute
}
