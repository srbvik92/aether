/**
 * Loads a per-project .chatui (or .chatui.json) config file from the workspace root.
 *
 * Teams commit this file to their repo to share:
 *   - Extra system-prompt rules specific to this project
 *   - A default model/provider override
 *   - Tool restrictions (e.g. prevent run_command in a sensitive repo)
 *   - Boilerplate rules like "always use TypeScript strict mode here"
 *
 * Example .chatui file:
 * {
 *   "model": "claude-sonnet-4-6",
 *   "rules": [
 *     "This is a Next.js 14 app — always use App Router, never Pages Router",
 *     "All database access goes through src/lib/db.ts",
 *     "Never import from @/app directly in server components"
 *   ],
 *   "disabledTools": ["run_command"],
 *   "systemPrompt": "You are working on the Acme Corp billing service. ..."
 * }
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { ProjectConfig } from '../shared/types'

const CANDIDATE_NAMES = ['.chatui', '.chatui.json']

export function loadProjectConfig(workspacePath: string): ProjectConfig | null {
  if (!workspacePath) return null
  for (const name of CANDIDATE_NAMES) {
    const filePath = join(workspacePath, name)
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8').trim()
        const parsed = JSON.parse(raw) as ProjectConfig
        return parsed
      } catch {
        // Malformed JSON — silently ignore so we don't break the agent
        return null
      }
    }
  }
  return null
}
