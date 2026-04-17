/**
 * Semantic search for the workspace — two tiers:
 *
 *  1. BM25 keyword index (always available, synchronous after build)
 *     Used by the agent's `semantic_search` tool.
 *     Built entirely in the main process — no ML model, no network required.
 *
 *  2. Dense embedding index (optional, built by the renderer WASM worker)
 *     384-dim vectors from `all-MiniLM-L6-v2` stored as JSON on disk.
 *     Main process loads them for cosine-similarity search when available.
 *
 * Both indexes are keyed by a short MD5 hash of the workspace path so
 * multiple workspaces don't collide.
 */

import { app } from 'electron'
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync
} from 'fs'
import { join, relative, extname } from 'path'
import { createHash } from 'crypto'
import { chunkFile, tokenize, FileChunk } from '../shared/chunker'

// ── File filter lists ─────────────────────────────────────────────────────────

const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php',
  '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.txt', '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.html', '.css', '.scss', '.sass', '.less',
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'out', 'build', '.next', '.nuxt', '__pycache__',
  '.venv', 'venv', 'env', 'vendor',
  'target', 'bin', 'obj', '.gradle',
  'coverage', '.nyc_output', '.cache', '.parcel-cache', '.turbo',
  'dist-electron'
])

const MAX_FILE_BYTES = 200_000   // 200 KB — skip very large files

// ── Data types ────────────────────────────────────────────────────────────────

export interface SearchResult {
  path:      string
  startLine: number
  endLine:   number
  excerpt:   string   // first 300 chars of the chunk body (no path prefix)
  score:     number
}

export interface IndexInfo {
  exists:      boolean
  chunkCount:  number
  fileCount:   number
  createdAt:   number
  hasEmbeddings: boolean
}

// Serialisable BM25 index stored on disk
interface BM25IndexFile {
  version:   1
  workspace: string
  createdAt: number
  fileCount: number
  avgLen:    number
  chunks:    FileChunk[]
  // term → [[chunkIdx, tf], ...]
  termFreqs: [string, [number, number][]][]
  docFreqs:  [string, number][]
}

// In-memory BM25 index (Maps are faster than plain objects at runtime)
interface BM25Index {
  chunks:    FileChunk[]
  termFreqs: Map<string, Map<number, number>>
  docFreqs:  Map<string, number>
  avgLen:    number
  workspace: string
  createdAt: number
  fileCount: number
}

// Dense embedding index format — written by the renderer worker, read by main
export interface EmbeddingIndexFile {
  version:   1
  workspace: string
  createdAt: number
  fileCount: number
  chunkCount: number
  chunks: {
    path:      string
    startLine: number
    endLine:   number
    text:      string
    embedding: number[]   // 384 floats
  }[]
}

// ── In-memory caches ──────────────────────────────────────────────────────────

const bm25Cache   = new Map<string, BM25Index>()
const embedCache  = new Map<string, EmbeddingIndexFile>()

// ── Path helpers ──────────────────────────────────────────────────────────────

function indexDir(): string {
  const dir = join(app.getPath('userData'), 'search-indices')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function workspaceHash(workspace: string): string {
  return createHash('md5').update(workspace).digest('hex').slice(0, 12)
}

function bm25Path(workspace: string): string {
  return join(indexDir(), `bm25-${workspaceHash(workspace)}.json`)
}

function embedPath(workspace: string): string {
  return join(indexDir(), `embed-${workspaceHash(workspace)}.json`)
}

// ── Workspace file walker ─────────────────────────────────────────────────────

export interface WorkspaceFile {
  path:    string   // relative, forward slashes
  content: string
}

export function readWorkspaceFiles(workspace: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = []

  function walk(dir: string) {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }

    for (const name of entries) {
      if (name.startsWith('.') && name !== '.env' && name !== '.env.example') continue
      const full = join(dir, name)
      let stats
      try { stats = statSync(full) } catch { continue }

      if (stats.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full)
      } else {
        if (stats.size > MAX_FILE_BYTES) continue
        if (!TEXT_EXTS.has(extname(name).toLowerCase())) continue
        try {
          const content = readFileSync(full, 'utf-8')
          files.push({
            path:    relative(workspace, full).replace(/\\/g, '/'),
            content
          })
        } catch { /* skip unreadable */ }
      }
    }
  }

  walk(workspace)
  return files
}

// ── BM25 index — build ────────────────────────────────────────────────────────

const K1 = 1.5
const B  = 0.75

export function buildBM25(
  workspace: string,
  onProgress?: (done: number, total: number) => void
): BM25Index {
  const files = readWorkspaceFiles(workspace)
  const allChunks: FileChunk[] = []

  files.forEach((f, i) => {
    allChunks.push(...chunkFile(f.path, f.content))
    onProgress?.(i + 1, files.length)
  })

  const termFreqs = new Map<string, Map<number, number>>()
  const docFreqs  = new Map<string, number>()
  let totalLen = 0

  allChunks.forEach((chunk, idx) => {
    const tokens = tokenize(chunk.text)
    totalLen += tokens.length

    const tf = new Map<string, number>()
    tokens.forEach(t => tf.set(t, (tf.get(t) ?? 0) + 1))

    tf.forEach((count, term) => {
      if (!termFreqs.has(term)) termFreqs.set(term, new Map())
      termFreqs.get(term)!.set(idx, count)
      docFreqs.set(term, (docFreqs.get(term) ?? 0) + 1)
    })
  })

  const index: BM25Index = {
    chunks: allChunks,
    termFreqs,
    docFreqs,
    avgLen:    allChunks.length ? totalLen / allChunks.length : 0,
    workspace,
    createdAt: Date.now(),
    fileCount: files.length
  }

  // Persist
  const file: BM25IndexFile = {
    version:   1,
    workspace: index.workspace,
    createdAt: index.createdAt,
    fileCount: index.fileCount,
    avgLen:    index.avgLen,
    chunks:    index.chunks,
    termFreqs: [...index.termFreqs.entries()].map(([t, m]) => [t, [...m.entries()]]),
    docFreqs:  [...index.docFreqs.entries()]
  }
  try { writeFileSync(bm25Path(workspace), JSON.stringify(file)) } catch { /* ignore */ }

  bm25Cache.set(workspace, index)
  return index
}

// ── BM25 index — load ─────────────────────────────────────────────────────────

function loadBM25(workspace: string): BM25Index | null {
  const cached = bm25Cache.get(workspace)
  if (cached) return cached

  try {
    const p = bm25Path(workspace)
    if (!existsSync(p)) return null
    const file: BM25IndexFile = JSON.parse(readFileSync(p, 'utf-8'))
    const index: BM25Index = {
      ...file,
      termFreqs: new Map(file.termFreqs.map(([t, entries]) => [t, new Map(entries)])),
      docFreqs:  new Map(file.docFreqs)
    }
    bm25Cache.set(workspace, index)
    return index
  } catch {
    return null
  }
}

// ── BM25 search ───────────────────────────────────────────────────────────────

export function bm25Search(query: string, workspace: string, topK = 5): SearchResult[] {
  const index = loadBM25(workspace)
  if (!index || index.chunks.length === 0) return []

  const queryTerms = [...new Set(tokenize(query))]
  const N = index.chunks.length
  const scores = new Float64Array(N)

  for (const term of queryTerms) {
    const df = index.docFreqs.get(term) ?? 0
    if (!df) continue
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
    const docMap = index.termFreqs.get(term)
    if (!docMap) continue

    docMap.forEach((tf, idx) => {
      const len  = tokenize(index.chunks[idx].text).length
      const norm = 1 - B + B * (len / index.avgLen)
      scores[idx] += idf * (tf * (K1 + 1)) / (tf + K1 * norm)
    })
  }

  return Array.from({ length: N }, (_, i) => i)
    .filter(i => scores[i] > 0)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, topK)
    .map(idx => {
      const chunk   = index.chunks[idx]
      const excerpt = chunk.text.replace(/^File: .+?\n/, '').slice(0, 300).trim()
      return { path: chunk.path, startLine: chunk.startLine, endLine: chunk.endLine, excerpt, score: scores[idx] }
    })
}

// ── Dense embedding index — save/load (written by renderer worker) ────────────

export function saveEmbeddingIndex(data: EmbeddingIndexFile): void {
  try {
    writeFileSync(embedPath(data.workspace), JSON.stringify(data))
    embedCache.set(data.workspace, data)
  } catch { /* ignore */ }
}

function loadEmbeddingIndex(workspace: string): EmbeddingIndexFile | null {
  const cached = embedCache.get(workspace)
  if (cached) return cached

  try {
    const p = embedPath(workspace)
    if (!existsSync(p)) return null
    const data: EmbeddingIndexFile = JSON.parse(readFileSync(p, 'utf-8'))
    embedCache.set(workspace, data)
    return data
  } catch {
    return null
  }
}

// ── Dense cosine-similarity search ────────────────────────────────────────────
// (query vector is supplied by the renderer — main does only the math)

export function vectorSearch(
  queryVector: number[],
  workspace:   string,
  topK = 5
): SearchResult[] {
  const index = loadEmbeddingIndex(workspace)
  if (!index || index.chunks.length === 0) return []

  const scores = index.chunks.map((chunk, i) => {
    let dot = 0
    const e = chunk.embedding
    for (let j = 0; j < queryVector.length; j++) dot += queryVector[j] * e[j]
    return { idx: i, score: dot }
  })

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ idx, score }) => {
      const chunk   = index.chunks[idx]
      const excerpt = chunk.text.replace(/^File: .+?\n/, '').slice(0, 300).trim()
      return { path: chunk.path, startLine: chunk.startLine, endLine: chunk.endLine, excerpt, score }
    })
}

// ── Index info ────────────────────────────────────────────────────────────────

export function getIndexInfo(workspace: string): IndexInfo {
  let bm25Exists = false, chunkCount = 0, fileCount = 0, createdAt = 0

  try {
    const p = bm25Path(workspace)
    if (existsSync(p)) {
      const file: BM25IndexFile = JSON.parse(readFileSync(p, 'utf-8'))
      bm25Exists = true
      chunkCount = file.chunks.length
      fileCount  = file.fileCount
      createdAt  = file.createdAt
    }
  } catch { /* ignore */ }

  let hasEmbeddings = false
  try {
    const p = embedPath(workspace)
    if (existsSync(p)) hasEmbeddings = true
  } catch { /* ignore */ }

  return { exists: bm25Exists, chunkCount, fileCount, createdAt, hasEmbeddings }
}

/** Clear both in-memory caches when workspace changes */
export function invalidateSemanticCache(workspace?: string): void {
  if (workspace) {
    bm25Cache.delete(workspace)
    embedCache.delete(workspace)
  } else {
    bm25Cache.clear()
    embedCache.clear()
  }
}
