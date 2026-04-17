/**
 * useSemanticIndex — manages the local embedding index lifecycle.
 *
 * Responsibilities:
 *   - Spin up the Web Worker (once, shared via module singleton)
 *   - Orchestrate "Build index": fetch files via IPC → chunk → embed → save
 *   - Expose "search by text": embed query in worker → call IPC vector search
 *   - Track progress and status
 *
 * The BM25 index (for the agent tool) is built entirely in main via IPC and
 * is completely separate — this hook only manages the dense embedding index.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import EmbeddingWorkerConstructor from '../workers/embedding.worker?worker'
import { chunkFile } from '../../../shared/chunker'

export type EmbeddingIndexPhase =
  | 'idle'
  | 'model-loading'     // worker is downloading/loading the ONNX model
  | 'fetching-files'    // IPC call to read workspace files
  | 'embedding'         // churning through chunks
  | 'saving'            // writing index to disk via IPC
  | 'done'
  | 'error'

export interface EmbeddingIndexState {
  phase:     EmbeddingIndexPhase
  progress:  number          // 0–100
  detail:    string          // human-readable status line
  chunksDone: number
  chunksTotal: number
}

export interface SemanticSearchResult {
  path:      string
  startLine: number
  endLine:   number
  excerpt:   string
  score:     number
}

// ── Module-level worker singleton ─────────────────────────────────────────────

let sharedWorker: Worker | null = null

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new EmbeddingWorkerConstructor()
  }
  return sharedWorker
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSemanticIndex(workspacePath: string) {
  const [state, setState] = useState<EmbeddingIndexState>({
    phase:       'idle',
    progress:    0,
    detail:      '',
    chunksDone:  0,
    chunksTotal: 0
  })

  // Map from message id → { resolve, reject } for pending worker messages
  const pending = useRef(new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>())

  // Wire up worker message handler once
  useEffect(() => {
    const worker = getWorker()

    const onMessage = (event: MessageEvent) => {
      const msg = event.data

      // Resolve/reject pending promises
      if (msg.id && pending.current.has(msg.id)) {
        const p = pending.current.get(msg.id)!
        if (msg.type === 'ERROR') {
          pending.current.delete(msg.id)
          p.reject(new Error(msg.message))
        } else if (msg.type === 'BATCH_DONE' || msg.type === 'QUERY_DONE') {
          pending.current.delete(msg.id)
          p.resolve(msg)
        }
        // BATCH_PROGRESS: don't resolve yet, update state instead
        if (msg.type === 'BATCH_PROGRESS') {
          setState(s => ({
            ...s,
            chunksDone:  msg.done,
            chunksTotal: msg.total,
            progress:    Math.round((msg.done / msg.total) * 100),
            detail:      `Embedding chunks… ${msg.done} / ${msg.total}`
          }))
        }
      } else {
        // Unsolicited messages (model loading progress)
        if (msg.type === 'MODEL_PROGRESS') {
          const pct = msg.progress != null ? Math.round(msg.progress) : undefined
          setState(s => ({
            ...s,
            phase:    'model-loading',
            detail:   `Downloading model: ${msg.file ?? ''}${pct != null ? ` (${pct}%)` : ''}`,
            progress: pct ?? s.progress
          }))
        }
        if (msg.type === 'MODEL_READY') {
          setState(s => ({ ...s, detail: 'Model ready' }))
        }
      }
    }

    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [])

  // ── Build the embedding index ─────────────────────────────────────────────

  const buildIndex = useCallback(async () => {
    if (!workspacePath) return

    setState({ phase: 'fetching-files', progress: 0, detail: 'Reading workspace files…', chunksDone: 0, chunksTotal: 0 })

    try {
      // 1. Fetch all workspace file contents from main
      const files = await window.api.getWorkspaceFiles(workspacePath)

      // 2. Chunk all files (shared chunker — same as BM25)
      const allChunks: { path: string; startLine: number; endLine: number; text: string }[] = []
      for (const f of files) {
        chunkFile(f.path, f.content).forEach(c =>
          allChunks.push({ path: c.path, startLine: c.startLine, endLine: c.endLine, text: c.text })
        )
      }

      setState(s => ({
        ...s,
        phase:       'model-loading',
        detail:      'Loading embedding model (first run downloads ~23 MB)…',
        chunksTotal: allChunks.length
      }))

      // 3. Send batch to worker
      const batchId = `batch-${Date.now()}`
      const worker  = getWorker()

      const result = await new Promise<{ chunks: { path: string; startLine: number; endLine: number; text: string; embedding: number[] }[] }>(
        (resolve, reject) => {
          pending.current.set(batchId, { resolve: resolve as (v: unknown) => void, reject })
          setState(s => ({ ...s, phase: 'embedding' }))
          worker.postMessage({ type: 'EMBED_BATCH', id: batchId, chunks: allChunks })
        }
      )

      // 4. Save via IPC
      setState(s => ({ ...s, phase: 'saving', progress: 99, detail: 'Saving index to disk…' }))

      await window.api.saveEmbeddingIndex({
        version:    1,
        workspace:  workspacePath,
        createdAt:  Date.now(),
        fileCount:  files.length,
        chunkCount: result.chunks.length,
        chunks:     result.chunks
      })

      setState({
        phase:       'done',
        progress:    100,
        detail:      `Indexed ${result.chunks.length} chunks across ${files.length} files`,
        chunksDone:  result.chunks.length,
        chunksTotal: result.chunks.length
      })

    } catch (err) {
      setState(s => ({
        ...s,
        phase:  'error',
        detail: err instanceof Error ? err.message : String(err)
      }))
    }
  }, [workspacePath])

  // ── Search by natural language ────────────────────────────────────────────

  const search = useCallback(async (query: string, topK = 5): Promise<SemanticSearchResult[]> => {
    if (!workspacePath || !query.trim()) return []

    const queryId = `query-${Date.now()}`
    const worker  = getWorker()

    const { embedding } = await new Promise<{ embedding: number[] }>((resolve, reject) => {
      pending.current.set(queryId, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ type: 'EMBED_QUERY', id: queryId, text: query })
    })

    return window.api.vectorSearch(workspacePath, embedding, topK)
  }, [workspacePath])

  return { state, buildIndex, search }
}
