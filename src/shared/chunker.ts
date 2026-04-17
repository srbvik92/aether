/**
 * Shared file-chunking logic used by both the BM25 indexer (main process)
 * and the embedding worker (renderer process).
 *
 * Each chunk is ~40 lines with 8-line overlap so consecutive chunks share
 * context. The file path is prepended so the model sees it as context.
 */

export interface FileChunk {
  path: string
  startLine: number   // 1-based
  endLine: number     // inclusive
  text: string        // includes "File: <path>\n" prefix
}

const CHUNK_LINES   = 40
const CHUNK_OVERLAP = 8

export function chunkFile(path: string, content: string): FileChunk[] {
  const lines  = content.split('\n')
  const chunks: FileChunk[] = []

  for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
    const end  = Math.min(start + CHUNK_LINES, lines.length)
    const body = lines.slice(start, end).join('\n').trim()
    if (body.length > 20) {
      chunks.push({
        path,
        startLine: start + 1,
        endLine:   end,
        text:      `File: ${path}\n${body}`
      })
    }
    if (end >= lines.length) break
  }

  return chunks
}

/** Tokenize for BM25 — lower-case, alphanumeric + common code chars, min length 2 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_$.]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && t.length <= 60)
}
