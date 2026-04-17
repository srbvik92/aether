/**
 * Web Worker: local embedding model via @xenova/transformers (WASM backend).
 *
 * Runs entirely in the renderer (Chromium) — no Node.js / native binaries.
 * Model (all-MiniLM-L6-v2, ~23 MB) downloads once from HuggingFace and is
 * cached in Electron's renderer storage automatically.
 *
 * Messages accepted:
 *   { type: 'EMBED_BATCH', id: string, chunks: { path, startLine, endLine, text }[] }
 *   { type: 'EMBED_QUERY', id: string, text: string }
 *
 * Messages emitted:
 *   { type: 'MODEL_PROGRESS', status, name, file, progress }
 *   { type: 'MODEL_READY' }
 *   { type: 'BATCH_PROGRESS', id, done, total }
 *   { type: 'BATCH_DONE',     id, chunks: { path, startLine, endLine, text, embedding }[] }
 *   { type: 'QUERY_DONE',     id, embedding: number[] }
 *   { type: 'ERROR',          id, message }
 */

// @ts-ignore — transformers.js has no official TypeScript declarations for workers
import { pipeline, env } from '@xenova/transformers'

// Always fetch from remote (HuggingFace CDN) — no need for local model files
env.allowLocalModels  = false
env.useBrowserCache   = true   // cache in renderer storage
env.backends.onnx.logSeverityLevel = 3  // quiet

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
let pipe: ((text: string, opts: object) => Promise<{ data: Float32Array }>) | null = null

async function loadModel(): Promise<void> {
  if (pipe) return
  pipe = await pipeline('feature-extraction', MODEL_ID, {
    progress_callback: (info: unknown) => {
      self.postMessage({ type: 'MODEL_PROGRESS', ...(info as object) })
    }
  })
  self.postMessage({ type: 'MODEL_READY' })
}

async function embedText(text: string): Promise<number[]> {
  await loadModel()
  // Truncate to avoid exceeding 512 token limit
  const truncated = text.slice(0, 1800)
  const output = await pipe!(truncated, { pooling: 'mean', normalize: true })
  return Array.from(output.data)
}

self.onmessage = async (event: MessageEvent) => {
  const { type, id } = event.data

  try {
    if (type === 'EMBED_BATCH') {
      const chunks: { path: string; startLine: number; endLine: number; text: string }[] =
        event.data.chunks

      await loadModel()

      const results: { path: string; startLine: number; endLine: number; text: string; embedding: number[] }[] = []

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const embedding = await embedText(chunk.text)
        results.push({ ...chunk, embedding })

        // Report progress every 10 chunks
        if (i % 10 === 0 || i === chunks.length - 1) {
          self.postMessage({ type: 'BATCH_PROGRESS', id, done: i + 1, total: chunks.length })
        }
      }

      self.postMessage({ type: 'BATCH_DONE', id, chunks: results })

    } else if (type === 'EMBED_QUERY') {
      const embedding = await embedText(event.data.text)
      self.postMessage({ type: 'QUERY_DONE', id, embedding })
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      id,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
