/**
 * Sub-agent runner for the `run_parallel_agents` tool.
 *
 * Spawns N mini agent loops in parallel (Promise.allSettled) using the
 * same provider as the main agent.  Each sub-agent:
 *   - Gets full tool access MINUS `run_parallel_agents` (prevents recursion)
 *   - Is capped at 8 iterations
 *   - Has its own AbortController
 *
 * Results are returned as a flat array so the caller can combine them
 * into a single tool-result string for the parent LLM.
 */

import { AppSettings } from '../shared/types'
import { DiffApprovalFn } from './tools'

export interface SubAgentTask {
  id:     string
  prompt: string
}

export interface SubAgentResult {
  id:     string
  result: string
  error?: string
}

export async function runSubAgentsParallel(
  tasks:         SubAgentTask[],
  context:       string | undefined,
  rawSettings:   AppSettings,
  workspacePath: string,
  onChunk:       (taskId: string, text: string) => void,
  onDone:        (taskId: string, result: string) => void,
  onError:       (taskId: string, error: string) => void,
): Promise<SubAgentResult[]> {
  // Sub-agents are capped at 8 iterations to avoid runaway loops
  const subAgentSettings: AppSettings = {
    ...rawSettings,
    workspacePath,
    maxIterations: 8,
  }

  // System prompt for sub-agents: optional shared context + task prompt is sent as the user message
  const contextPrefix = context?.trim()
    ? `${context.trim()}\n\n`
    : ''

  const results = await Promise.allSettled(
    tasks.map(task => runOneSubAgent(
      task,
      contextPrefix,
      subAgentSettings,
      onChunk,
      onDone,
      onError,
    ))
  )

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason)
    return { id: tasks[i].id, result: '', error: errMsg }
  })
}

async function runOneSubAgent(
  task:          SubAgentTask,
  contextPrefix: string,
  settings:      AppSettings,
  onChunk:       (taskId: string, text: string) => void,
  onDone:        (taskId: string, result: string) => void,
  onError:       (taskId: string, error: string) => void,
): Promise<SubAgentResult> {
  const abort = new AbortController()

  // Build minimal callback set — sub-agents don't show diff approvals,
  // all commands are auto-approved, and no snapshot tracking needed.
  const noDiff: DiffApprovalFn = (_path, _before, after, _isNew) => Promise.resolve(after)

  const userPrompt = contextPrefix + task.prompt

  const messages = [{ role: 'user' as const, content: userPrompt }]

  let fullText = ''

  // No-op callbacks — sub-agents don't surface tool events to the UI.
  // Underscore prefix tells TypeScript these params are intentionally unused.
  const noopStart   = (_callId: string, _name: string, _input: Record<string, unknown>) => { /* no-op */ }
  const noopResult  = (_callId: string, _output: string, _isError: boolean) => { /* no-op */ }
  const noopChunk   = (_callId: string, _chunk: string) => { /* no-op */ }

  try {
    if (settings.provider === 'anthropic') {
      const { runAnthropicAgentLoop } = await import('./agent-loop')
      await runAnthropicAgentLoop(messages, settings, {
        onTextChunk:       (text) => { fullText += text; onChunk(task.id, text) },
        onToolCallStart:   noopStart,
        onToolCallResult:  noopResult,
        onToolOutputChunk: noopChunk,
        onDiffRequest:     noDiff,
        abortSignal:       abort.signal,
        onParallelAgents:  undefined,   // sub-agents cannot spawn further sub-agents
      })
    } else if (
      settings.provider === 'openai' ||
      settings.provider === 'custom' ||
      settings.provider === 'nvidia' ||
      settings.provider === 'openrouter'
    ) {
      const { runOpenAIAgentLoop } = await import('./openai-agent-loop')
      await runOpenAIAgentLoop(messages, settings, {
        onTextChunk:       (text) => { fullText += text; onChunk(task.id, text) },
        onToolCallStart:   noopStart,
        onToolCallResult:  noopResult,
        onToolOutputChunk: noopChunk,
        onDiffRequest:     noDiff,
        abortSignal:       abort.signal,
        onParallelAgents:  undefined,
      })
    } else if (settings.provider === 'gemini') {
      const { runGeminiAgentLoop } = await import('./gemini-agent-loop')
      await runGeminiAgentLoop(messages, settings, {
        onTextChunk:       (text) => { fullText += text; onChunk(task.id, text) },
        onToolCallStart:   noopStart,
        onToolCallResult:  noopResult,
        onToolOutputChunk: noopChunk,
        onDiffRequest:     noDiff,
        abortSignal:       abort.signal,
        onParallelAgents:  undefined,
      })
    } else {
      // Fallback: unknown provider — return error
      const msg = `Provider "${settings.provider}" not supported for sub-agents.`
      onError(task.id, msg)
      return { id: task.id, result: '', error: msg }
    }

    onDone(task.id, fullText)
    return { id: task.id, result: fullText }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    onError(task.id, errMsg)
    return { id: task.id, result: fullText, error: errMsg }
  }
}
