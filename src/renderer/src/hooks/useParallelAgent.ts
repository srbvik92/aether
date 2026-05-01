import { useState, useEffect, useCallback } from 'react'
import {
  AppSettings,
  ParallelTask,
  ParallelSendPayload,
  ParallelStartPayload,
  ParallelChunkPayload,
  ParallelDonePayload,
  ParallelErrorPayload,
} from '../../../shared/types'

export interface TaskState {
  id:      string
  title:   string
  content: string
  status:  'pending' | 'streaming' | 'done' | 'error'
  error?:  string
}

export function useParallelAgent(
  conversationId: string,
  settings: AppSettings,
  workspacePath?: string,
) {
  const [tasks,          setTasks]          = useState<TaskState[]>([])
  const [isRunning,      setIsRunning]      = useState(false)
  const [autoTriggered,  setAutoTriggered]  = useState(false)

  // Register IPC listeners once
  useEffect(() => {
    window.api.onParallelStart((p: ParallelStartPayload) => {
      if (p.conversationId !== conversationId) return
      setTasks(prev => {
        const existing = prev.find(t => t.id === p.taskId)
        if (existing) {
          // Manual run: task already exists, just move to streaming
          return prev.map(t => (t.id === p.taskId ? { ...t, status: 'streaming' as const } : t))
        }
        // LLM-triggered: task doesn't exist yet — create it as streaming
        setIsRunning(true)
        setAutoTriggered(true)
        return [...prev, { id: p.taskId, title: p.title, content: '', status: 'streaming' as const }]
      })
    })

    window.api.onParallelChunk((p: ParallelChunkPayload) => {
      if (p.conversationId !== conversationId) return
      setTasks(prev =>
        prev.map(t => (t.id === p.taskId ? { ...t, content: t.content + p.chunk } : t)),
      )
    })

    window.api.onParallelDone((p: ParallelDonePayload) => {
      if (p.conversationId !== conversationId) return
      setTasks(prev => {
        const updated = prev.map(t =>
          t.id === p.taskId ? { ...t, status: 'done' as const, content: p.fullText } : t,
        )
        if (updated.every(t => t.status === 'done' || t.status === 'error')) {
          setIsRunning(false)
        }
        return updated
      })
    })

    window.api.onParallelError((p: ParallelErrorPayload) => {
      if (p.conversationId !== conversationId) return
      setTasks(prev => {
        const updated = prev.map(t =>
          t.id === p.taskId ? { ...t, status: 'error' as const, error: p.error } : t,
        )
        if (updated.every(t => t.status === 'done' || t.status === 'error')) {
          setIsRunning(false)
        }
        return updated
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const runParallel = useCallback(
    async (parallelTasks: ParallelTask[]) => {
      setIsRunning(true)
      setTasks(
        parallelTasks.map(t => ({ id: t.id, title: t.title, content: '', status: 'pending' as const })),
      )
      const payload: ParallelSendPayload = {
        conversationId,
        tasks: parallelTasks,
        settings,
        workspacePath,
      }
      await window.api.sendParallel(payload)
    },
    [conversationId, settings, workspacePath],
  )

  const abort = useCallback(() => {
    window.api.abortParallel(conversationId)
    setIsRunning(false)
    setTasks(prev =>
      prev.map(t =>
        t.status === 'streaming' || t.status === 'pending'
          ? { ...t, status: 'error' as const, error: 'Aborted' }
          : t,
      ),
    )
  }, [conversationId])

  const clear = useCallback(() => {
    setTasks([])
    setIsRunning(false)
    setAutoTriggered(false)
  }, [])

  return { tasks, isRunning, autoTriggered, runParallel, abort, clear }
}
