/**
 * Workspace indexer — builds a compact text summary of the project
 * that is automatically injected into the AI's system prompt.
 *
 * What it does:
 *   1. Detects the project type (Node, Python, Rust, Go, etc.)
 *   2. Walks the directory tree (skipping noise dirs)
 *   3. Returns a compact text block the AI can use to navigate the codebase
 *      without having to call list_directory manually on every turn.
 *
 * Caching: result is cached per workspace path. Call `invalidateCache()`
 * when the workspace changes.
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join, relative, extname } from 'path'
import { buildGitSummary, isGitRepo } from './git'

// ── Skip lists ────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'out', 'build', '.next', '.nuxt', '__pycache__',
  '.venv', 'venv', 'env', '.env', 'vendor',
  'target',         // Rust
  'bin', 'obj',     // C#
  '.gradle',        // Java/Kotlin
  'coverage', '.nyc_output',
  '.cache', '.parcel-cache', '.turbo'
])

const SKIP_EXT = new Set([
  '.lock', '.sum',           // lockfiles
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.ttf', '.woff', '.woff2', '.eot',
  '.mp3', '.mp4', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar',
  '.pdf', '.docx', '.xlsx',
  '.db', '.sqlite', '.sqlite3',
  '.pyc', '.pyo',
  '.class', '.jar',
  '.dll', '.exe', '.so', '.dylib',
])

// ── Project type detection ─────────────────────────────────────────────────
interface ProjectType {
  name:   string
  emoji:  string
  hints:  string
}

function detectProjectType(root: string): ProjectType {
  const has = (f: string) => existsSync(join(root, f))

  if (has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps['next'])    return { name: 'Next.js',  emoji: '▲', hints: 'App is in /app or /pages. Use `npm run dev` to start.' }
      if (deps['react'])   return { name: 'React',    emoji: '⚛', hints: 'Use `npm start` or `npm run dev`. Components in /src.' }
      if (deps['vue'])     return { name: 'Vue',      emoji: '💚', hints: 'Use `npm run dev`. Components in /src.' }
      if (deps['svelte'])  return { name: 'Svelte',   emoji: '🔥', hints: 'Use `npm run dev`. Components in /src.' }
      if (deps['express'] || deps['fastify'] || deps['koa']) {
        return { name: 'Node.js API', emoji: '🚀', hints: 'Use `node index.js` or `npm start`.' }
      }
      if (deps['electron']) return { name: 'Electron', emoji: '⚡', hints: 'Use `npm run dev`. Main process in /src/main, renderer in /src/renderer.' }
    } catch { /* ignore parse errors */ }
    return { name: 'Node.js', emoji: '📦', hints: 'Use `npm install` then check package.json scripts.' }
  }

  if (has('requirements.txt') || has('pyproject.toml') || has('setup.py')) {
    if (has('manage.py')) return { name: 'Django',  emoji: '🐍', hints: 'Use `python manage.py runserver`.' }
    if (has('app.py') || has('main.py')) return { name: 'Python app', emoji: '🐍', hints: 'Use `python main.py` or `python app.py`.' }
    return { name: 'Python', emoji: '🐍', hints: 'Use `pip install -r requirements.txt` to install deps.' }
  }

  if (has('Cargo.toml')) return { name: 'Rust', emoji: '🦀', hints: 'Use `cargo build` / `cargo run` / `cargo test`.' }
  if (has('go.mod'))     return { name: 'Go',   emoji: '🐹', hints: 'Use `go run .` / `go build` / `go test ./...`.' }
  if (has('pom.xml'))    return { name: 'Java Maven',  emoji: '☕', hints: 'Use `mvn compile` / `mvn test`.' }
  if (has('build.gradle') || has('build.gradle.kts')) {
    return { name: 'Kotlin/Java Gradle', emoji: '☕', hints: 'Use `./gradlew build` / `./gradlew test`.' }
  }
  if (has('*.csproj') || has('*.sln')) return { name: 'C#/.NET', emoji: '🔷', hints: 'Use `dotnet run` / `dotnet test`.' }
  if (has('CMakeLists.txt')) return { name: 'C/C++ CMake', emoji: '⚙️', hints: 'Use `cmake .` then `make`.' }

  return { name: 'Unknown', emoji: '📁', hints: 'Explore files to understand the project structure.' }
}

// ── Directory walker ───────────────────────────────────────────────────────
interface FileEntry {
  path:  string   // relative to workspace root
  size:  number
  ext:   string
}

function walkDir(dir: string, root: string, depth = 0, max = 4): FileEntry[] {
  if (depth > max) return []

  let entries: string[]
  try { entries = readdirSync(dir) } catch { return [] }

  const results: FileEntry[] = []

  for (const name of entries.sort()) {
    if (name.startsWith('.') && !name.startsWith('.env')) continue

    const full = join(dir, name)
    let stats
    try { stats = statSync(full) } catch { continue }

    if (stats.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      results.push(...walkDir(full, root, depth + 1, max))
    } else {
      const ext = extname(name).toLowerCase()
      if (SKIP_EXT.has(ext)) continue
      results.push({
        path: relative(root, full).replace(/\\/g, '/'),
        size: stats.size,
        ext
      })
    }
  }

  return results
}

// ── Tree renderer ─────────────────────────────────────────────────────────
function renderTree(files: FileEntry[], root: string): string {
  // Group by directory
  const dirs = new Map<string, string[]>()

  files.forEach(f => {
    const parts = f.path.split('/')
    const dir   = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir)!.push(parts[parts.length - 1])
  })

  const lines: string[] = []
  const sortedDirs = [...dirs.keys()].sort()

  for (const dir of sortedDirs) {
    const fileNames = dirs.get(dir)!
    if (dir === '.') {
      fileNames.forEach(f => lines.push(f))
    } else {
      lines.push(`${dir}/`)
      fileNames.forEach(f => lines.push(`  ${f}`))
    }
  }

  return lines.join('\n')
}

// ── Cache ────────────────────────────────────────────────────────────────────
const cache = new Map<string, { summary: string; ts: number }>()
const CACHE_TTL_MS = 60_000  // 1 minute

export function invalidateCache(workspacePath?: string) {
  if (workspacePath) cache.delete(workspacePath)
  else cache.clear()
}

// ── Main export ───────────────────────────────────────────────────────────────
export function buildWorkspaceSummary(workspacePath: string): string {
  if (!workspacePath || !existsSync(workspacePath)) return ''

  // Check cache
  const cached = cache.get(workspacePath)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.summary

  const projectType = detectProjectType(workspacePath)
  const files       = walkDir(workspacePath, workspacePath)
  const fileCount   = files.length

  // Limit tree to avoid flooding context
  const displayFiles = files.slice(0, 300)
  const tree = renderTree(displayFiles, workspacePath)

  // Git context (not cached separately — included in workspace summary)
  const gitSummary = isGitRepo(workspacePath) ? buildGitSummary(workspacePath) : ''

  const summary = [
    `## Workspace: ${workspacePath}`,
    `**Project type:** ${projectType.emoji} ${projectType.name}`,
    `**Hints:** ${projectType.hints}`,
    `**Files:** ${fileCount}${fileCount > 300 ? ' (showing first 300)' : ''}`,
    '',
    ...(gitSummary ? ['### Git status', gitSummary, ''] : []),
    '### File tree',
    '```',
    tree,
    '```',
    '',
    'Use the read_file, write_file, list_directory, search_files, run_command, git_status, git_diff, git_log, git_add, and git_commit tools to work with this codebase.'
  ].join('\n')

  cache.set(workspacePath, { summary, ts: Date.now() })
  return summary
}
