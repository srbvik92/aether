// ─── Provider & Settings ───────────────────────────────────────────────────

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'nvidia' | 'openrouter' | 'custom'

/** A user-saved custom provider entry (OpenAI-compatible endpoint) */
export interface CustomProviderConfig {
  id:      string   // uuid
  name:    string   // e.g. "Ollama local", "LM Studio", "My Proxy"
  baseUrl: string   // e.g. http://localhost:11434/v1
  apiKey:  string   // empty string for local/unauthenticated endpoints
  model:   string   // default model name for this provider
}

export interface AppSettings {
  provider: Provider
  apiKey: string        // Anthropic / OpenAI key. For Gemini: unused (uses SA key)
  baseUrl: string
  model: string
  maxTokens: number
  systemPrompt: string
  theme: 'dark' | 'light' | 'system'

  // ── Vertex AI / Gemini ──────────────────────────────────────────────────
  vertexProjectId: string   // GCP project ID
  vertexLocation: string    // e.g. "us-central1"
  vertexServiceAccountKey: string  // full JSON content of the service account key

  // ── Agent / Tool use ────────────────────────────────────────────────────
  workspacePath: string     // root directory the agent can read/write/exec in

  // ── Web / Search ─────────────────────────────────────────────────────────
  braveApiKey: string       // Brave Search API key (optional — enables web_search tool)

  // ── Agent loop ───────────────────────────────────────────────────────────
  maxIterations: number     // max tool-call rounds per turn (default 100)
  temperature?: number  // AI temperature 0-1 (undefined = model default)
  topP?:        number  // nucleus sampling 0-1 (undefined = model default)
  trustedCommands: string[] // command prefixes auto-approved without a prompt
  recentWorkspaces: string[]

  // ── Project config override (runtime only — not persisted) ───────────────
  disabledTools?: string[]  // tool names blocked by .chatui config

  // ── Shell command approval ────────────────────────────────────────────────
  trustedCommands?: string[]  // command prefixes auto-approved without prompting

  // ── Recent workspaces ─────────────────────────────────────────────────────
  recentWorkspaces?: string[]  // last N workspace paths, most recent first

  // ── GitHub integration ────────────────────────────────────────────────────
  githubToken?: string

  // ── Agent Presets ─────────────────────────────────────────────────────────
  // (presets stored separately, not in settings)

  // ── RAG ───────────────────────────────────────────────────────────────────
  ragEnabled?: boolean         // auto-inject semantically relevant context chunks

  // ── HTTP API Server ───────────────────────────────────────────────────────
  apiServerEnabled?: boolean   // expose local REST API on apiServerPort
  apiServerPort?:    number    // default 39400

  // ── OpenAI OAuth (Sign in with OpenAI — uses ChatGPT subscription) ──────────
  openaiOAuth?: {
    accessToken:   string
    refreshToken?: string
    expiresAt?:    number   // Unix ms
    tokenType:     string
    email?:        string
    name?:         string
    planType?:     string   // 'free' | 'plus' | 'pro' | 'business' | 'enterprise'
    accountId?:    string   // chatgpt_account_id — sent as ChatGPT-Account-ID header
  }

  // ── MCP Servers ───────────────────────────────────────────────────────────
  mcpServers?: McpServerConfig[]

  // Tier 6 — Deep Integrations
  jiraUrl?:            string
  jiraEmail?:          string
  jiraToken?:          string
  linearToken?:        string
  webhookUrl?:         string
  webhookEnabled?:     boolean
  dockerEnabled?:      boolean
  dockerImage?:        string
  dbConnectionString?: string
  onboardingComplete?: boolean

  // ── Custom Providers ──────────────────────────────────────────────────────
  customProviders?:          CustomProviderConfig[]  // saved custom provider list
  selectedCustomProviderId?: string                  // ID of active custom provider

  // ── Reasoning depth ───────────────────────────────────────────────────────
  // Controls extended thinking / reasoning effort where supported.
  // Anthropic: budget_tokens  OpenAI o-series: reasoning_effort  Gemini 2.5: thinkingBudget
  reasoningDepth?: 'off' | 'low' | 'medium' | 'high'

  // ── Edit approval ─────────────────────────────────────────────────────────
  // When true (default), the AI pauses before writing any file and shows a
  // diff for the user to approve or reject — identical to Claude Code's flow.
  requireEditApproval?: boolean

  // ── Command approval ──────────────────────────────────────────────────────
  // When true, all non-dangerous commands run without the approval modal.
  // Dangerous commands (rm -rf, git reset --hard, etc.) always require approval.
  autoApproveCommands?: boolean

  // ── Fast / lightweight model ──────────────────────────────────────────────
  // When set, lightweight tasks (auto-title, inline completions) use this
  // model instead of the primary model, saving cost and latency.
  fastModel?: string   // e.g. "claude-haiku-4-5", "gpt-4o-mini"

  // ── Feature flags ─────────────────────────────────────────────────────────
  features?: {
    httpBuilder?:      boolean   // HTTP Request Builder panel
    dependencyAudit?:  boolean   // Dependency Audit panel
    dockerManager?:    boolean   // Docker Manager panel
    regexTester?:      boolean   // Regex Tester panel
    dbBrowser?:        boolean   // Database Browser panel
    testRunner?:       boolean   // Test Runner panel
    embeddedBrowser?:  boolean   // Embedded Browser with provider connectors
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'anthropic',
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-4-6',
  maxTokens: 8096,
  systemPrompt: `You are an elite software engineer — deeply experienced, precise, and relentless. You have direct access to the user's codebase through tools and you do not stop working until the task is fully, verifiably complete.

## Core philosophy

You finish what you start. A task is not done until:
1. Every file that needed changing has been changed
2. The code compiles / type-checks with zero errors
3. Relevant tests pass (or you wrote new ones and they pass)
4. You have read back every file you touched and confirmed the change landed correctly

"I think that should work" is never acceptable. Verify — always.

## Phase 1 — Understand before touching anything

Before writing a single character of code:
1. Run list_directory on the project root to map the structure
2. Run search_files to locate every file relevant to the task (by function name, type name, import path, etc.)
3. Run read_file on every file you will modify — never edit blind
4. Identify all shared types, interfaces, and contracts that must stay consistent across files
5. State your plan: one line per file — what you will change and why

If the task is large, break it into phases. Complete each phase fully before starting the next.

## Phase 2 — Edit with surgical precision

- **ALWAYS use str_replace** for existing files — it makes changes reviewable and atomic
- Use write_file only for brand-new files that do not exist yet
- Each str_replace must include 3–5 lines of surrounding context so the match is unambiguous
- Make one logical change at a time — do not bundle unrelated edits
- Never touch code outside the scope of the current task
- For files over 300 lines, use read_file_range to read only the section you need

**Dependency order for multi-file changes:**
Types/interfaces → shared utilities → implementations → callers → tests

## Phase 3 — Verify every change

After each edit:
1. Read back the modified section with read_file or read_file_range
2. Confirm the change appears exactly as intended — no stray whitespace, no missing lines
3. If the project has a type-checker (tsc, mypy, cargo check, etc.), run it after every significant change
4. If tests exist, run them. If they fail, fix them before moving on — never leave a broken test suite

## Handling errors — never give up

When a tool call returns an error or a command fails:
1. Read the full error message — every word
2. Re-read the relevant file section to understand the actual current state
3. Form a specific hypothesis about the root cause
4. Try a targeted fix — do not repeat the same failing call
5. If two attempts fail, try a completely different approach
6. Only ask the user for guidance after exhausting at least three distinct approaches

Compilation errors, test failures, and type errors are YOUR problem to fix, not the user's.

## Multi-file and large tasks

- Explore ALL affected files before editing any of them
- Keep a mental (or written) checklist of every file that needs a change
- After completing all edits, run search_files one final time to catch any references you missed
- Cross-file consistency: if you change a function signature, find and update every caller
- If you add a new exported symbol, check whether it needs to be re-exported from an index file

## Code quality standards

- Match the style, formatting, and naming conventions of the surrounding code exactly
- Do not introduce new dependencies without checking package.json first
- Do not leave TODO comments, console.log debug lines, or dead code behind
- If you must make a trade-off, explain it clearly and ask if it is acceptable
- Security: never log, expose, or hard-code API keys, tokens, or secrets

## Web research

- If the user's message contains a URL, always fetch_url it before answering
- Use web_search for: current API docs, error messages you don't recognise, library versions, best practices
- Research process: search → fetch the top 2–3 pages → cross-reference → then answer
- If the first search doesn't resolve it, rephrase and search again — do not give up after one query
- Cite URLs when you use fetched content

## Communication

- Be direct and concise — no filler like "Certainly!" or "Great question!"
- Lead with what you are doing, not why you are great at it
- When summarising changes, use a tight bullet list — one line per file changed
- If something is ambiguous, ask exactly ONE focused question before proceeding
- When you hit a blocker, describe: what you tried, what happened, and what you need

## Memory

- Call remember to save project-specific facts (tech stack decisions, architecture notes, known gotchas) to \`.ai-memory/notes.md\`
- Call remember_globally for facts that apply across all projects: user's name, preferred style, deployment targets, personal conventions
- Trigger remember_globally immediately when the user states a preference — do not wait to be asked

## Project summary

After any significant task (new feature, refactor, bug fix, architecture change), call update_project_summary to write a current PROJECT.md. It must enable a developer — or another AI — to immediately understand and continue the work. Include:
- What the project does (2–3 sentences)
- Tech stack and key dependencies with versions
- Architecture overview: how the main pieces connect
- Key files table: file path → what it owns
- Conventions: naming, file structure, state management, testing approach
- What changed this session and why
- Known issues or decisions that need revisiting

Overwrite any existing summary — always keep it current.`,
  theme: 'dark',
  // Vertex
  vertexProjectId: '',
  vertexLocation: 'global',
  vertexServiceAccountKey: '',
  // Agent
  workspacePath: '',
  braveApiKey: '',
  maxIterations: 100,
  trustedCommands: [
    // Node / JS
    'npm test', 'npm run test', 'npm run build', 'npm run dev', 'npm run lint',
    'npm run typecheck', 'npm run check', 'npm run format', 'npm run tsc',
    'yarn test', 'yarn build', 'yarn dev', 'yarn lint',
    'pnpm test', 'pnpm build', 'pnpm dev', 'pnpm lint',
    'npx tsc', 'tsc',
    // Rust
    'cargo test', 'cargo build', 'cargo check', 'cargo fmt', 'cargo clippy', 'cargo run',
    // Go
    'go test', 'go build', 'go vet', 'go fmt', 'go run',
    // Python
    'python -m pytest', 'pytest', 'python manage.py test',
    'python -m mypy', 'mypy', 'ruff check', 'black',
    // Build tools
    'make test', 'make build', 'make', 'make lint',
    'dotnet test', 'dotnet build', 'dotnet run',
    'mvn test', 'mvn compile', 'gradle test', 'gradle build',
    // Git read-only
    'git status', 'git log', 'git diff', 'git show', 'git branch',
  ],
  recentWorkspaces: [],
  requireEditApproval: true,
  features: {},
}

// ─── Models per provider ────────────────────────────────────────────────────

export const PROVIDER_MODELS: Record<Provider, string[]> = {
  anthropic: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5'
  ],
  openai: [
    // ── GPT-5 family (2025) ─────────────────────────────────────────────────
    'gpt-5',
    'gpt-5.1',
    'gpt-5.2',
    'gpt-5.3',
    'gpt-5.4',
    'gpt-5.5',
    // ── GPT-4.1 family (2025) ───────────────────────────────────────────────
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    // ── O-series reasoning models ───────────────────────────────────────────
    'o4-mini',
    'o3',
    'o3-mini',
    'o1',
    'o1-mini',
    // ── GPT-4o family ────────────────────────────────────────────────────────
    'gpt-4o',
    'gpt-4o-mini',
    // ── Legacy ───────────────────────────────────────────────────────────────
    'gpt-4-turbo',
    'gpt-3.5-turbo',
  ],
  gemini: [
    'gemini-3.1-pro-preview',
    'gemini-2.5-pro-preview-05-06',
    'gemini-2.5-flash-preview-04-17',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite-001',
    'gemini-1.5-pro-002',
    'gemini-1.5-flash-002'
  ],
  nvidia: [
    // ── Meta / Llama ────────────────────────────────────────────────────────
    'meta/llama-3.3-70b-instruct',
    'meta/llama-3.1-405b-instruct',
    'meta/llama-3.1-70b-instruct',
    'meta/llama-3.1-8b-instruct',
    'meta/llama-3.2-3b-instruct',
    'meta/llama-3.2-1b-instruct',
    'meta/llama-3.2-90b-vision-instruct',
    'meta/llama-3.2-11b-vision-instruct',
    'meta/codellama-70b',
    // ── NVIDIA Nemotron ─────────────────────────────────────────────────────
    'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    'nvidia/llama-3.3-nemotron-super-49b-v1',
    'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    'nvidia/llama-3.1-nemotron-nano-8b-v1',
    'nvidia/nemotron-mini-4b-instruct',
    // ── Mistral ─────────────────────────────────────────────────────────────
    'mistralai/mistral-nemotron',
    'mistralai/mistral-large',
    'mistralai/mistral-small-24b-instruct',
    'mistralai/mixtral-8x22b-instruct',
    'mistralai/mixtral-8x7b-instruct',
    'mistralai/mistral-7b-instruct-v0.3',
    'mistralai/codestral-22b-instruct-v0.1',
    'mistralai/mathstral-7b-v01',
    // ── DeepSeek ────────────────────────────────────────────────────────────
    'deepseek-ai/deepseek-v3.1',
    'deepseek-ai/deepseek-r1-distill-qwen-32b',
    'deepseek-ai/deepseek-r1-distill-qwen-14b',
    'deepseek-ai/deepseek-r1-distill-qwen-7b',
    'deepseek-ai/deepseek-r1-distill-llama-8b',
    // ── Qwen ────────────────────────────────────────────────────────────────
    'qwen/qwen3-coder-480b-a35b-instruct',
    'qwen/qwen3-5-122b-a10b',
    'qwen/qwq-32b',
    'qwen/qwen2.5-coder-32b-instruct',
    'qwen/qwen2.5-coder-7b-instruct',
    'qwen/qwen2.5-7b-instruct',
    // ── Google Gemma ────────────────────────────────────────────────────────
    'google/gemma-2-27b-it',
    'google/gemma-2-9b-it',
    'google/gemma-3-1b-it',
    'google/codegemma-1.1-7b',
    // ── Microsoft Phi ───────────────────────────────────────────────────────
    'microsoft/phi-4-mini-instruct',
    'microsoft/phi-4-mini-flash-reasoning',
    'microsoft/phi-3.5-mini',
    'microsoft/phi-3-medium-128k-instruct',
    'microsoft/phi-3-mini-128k-instruct',
    // ── MiniMax ─────────────────────────────────────────────────────────────
    'minimaxai/minimax-m2.5',
    'minimaxai/minimax-m2.7',
    // ── Z-AI / GLM (Zhipu AI) ───────────────────────────────────────────────
    'z-ai/glm4.7',
    'z-ai/glm5',
    // ── IBM Granite ─────────────────────────────────────────────────────────
    'ibm/granite-3_3-8b-instruct',
    'ibm/granite-guardian-3.0-8b',
    // ── Moonshot ────────────────────────────────────────────────────────────
    'moonshotai/kimi-k2-instruct',
    // ── TII Falcon ──────────────────────────────────────────────────────────
    'tiiuae/falcon3-7b-instruct',
    // ── Other ───────────────────────────────────────────────────────────────
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'bytedance/seed-oss-36b-instruct',
    'ai21labs/jamba-1.5-mini-instruct',
    'bigcode/starcoder2-7b',
    'upstage/solar-10.7b-instruct',
    'abacusai/dracarys-llama-3.1-70b-instruct',
    'sarvamai/sarvam-m',
    'marin/marin-8b-instruct',
    'igenius/colosseum_355b_instruct_16k',
  ],
  openrouter: [], // populated dynamically at launch from https://openrouter.ai/api/v1/models
  custom: []      // models come from saved CustomProviderConfig entries
}

export const PROVIDER_BASE_URLS: Record<Provider, string> = {
  anthropic:   'https://api.anthropic.com',
  openai:      'https://api.openai.com/v1',
  gemini:      '',                                // uses GCP project + location
  nvidia:      'https://integrate.api.nvidia.com/v1',
  openrouter:  'https://openrouter.ai/api/v1',
  custom:      'http://localhost:11434/v1'
}

export const VERTEX_LOCATIONS = [
  'global',
  'us-central1',
  'us-east1',
  'us-east4',
  'us-west1',
  'us-west4',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'asia-east1',
  'asia-northeast1',
  'asia-southeast1',
  'australia-southeast1'
]

// ─── Tool use ─────────────────────────────────────────────────────────────

export interface ToolCallDisplay {
  id:                string
  name:              string
  input:             Record<string, unknown>
  output?:           string
  liveOutput?:       string   // streaming output while status === 'running'
  isError:           boolean
  status:            'running' | 'done' | 'error' | 'awaiting-approval' | 'stopped'
  approvalId?:       string   // set while waiting for cmd approval — used to reject via Stop
  diffPayload?:      DiffRequestPayload   // set when this tool call triggered a diff approval
  diffId?:           string               // the diff approval ID
}

// ─── Chat ──────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChangedFile {
  path:      string
  operation: 'created' | 'modified'
}

export interface UrlFetch {
  url:     string
  content: string   // cleaned page text injected into AI context
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  isStreaming?: boolean
  stopped?: boolean              // true when the user manually aborted the stream
  error?: string
  toolCalls?: ToolCallDisplay[]  // tool calls made during this AI turn
  images?: ImageAttachment[]     // vision: images attached to a user message
  changedFiles?: ChangedFile[]   // files written during this AI turn
  snapshotId?:  string           // snapshot ID — set when undo is available
  rating?:      'up' | 'down'   // user thumbs up/down rating (AI messages only)
  agentMode?:   boolean          // true when this message was generated in Agent mode
  urlFetches?:  UrlFetch[]       // pre-fetched URL content (shown collapsed in UI, injected into AI context)
}

export type ConversationMode = 'code' | 'agent' | 'voice' | 'review' | 'pair'

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  provider: Provider
  model: string
  tags?: string[]
  mode?: ConversationMode
  workspacePath?: string  // per-conversation folder; AI tools are restricted to this path

  // ── Branching ────────────────────────────────────────────────────────────
  /** ID of the conversation this was forked from (undefined = root) */
  parentConversationId?: string
  /** Message ID in the parent at which the fork was created */
  branchFromMessageId?:  string
}

// ─── Shell command approval ────────────────────────────────────────────────

export interface CmdApprovalPayload {
  id:          string
  command:     string
  workspace:   string
  isDangerous: boolean   // true when command matches a known destructive pattern
  callId?:     string    // tool call ID — used to link approval to the tool card in the UI
}

// ─── Per-project config (.chatui / .chatui.json in workspace root) ─────────

export interface ProjectConfig {
  /** Appended to the system prompt for every conversation in this workspace */
  systemPrompt?: string
  /** Override the model for this workspace (new conversations only) */
  model?: string
  /** Override the provider for this workspace (new conversations only) */
  provider?: Provider
  /** Override max tool-call iterations */
  maxIterations?: number
  /** Tool names the AI is not allowed to call in this workspace */
  disabledTools?: string[]
  /** Plain-language rules appended as a numbered list to the system prompt */
  rules?: string[]
}

// ─── Prompt library ────────────────────────────────────────────────────────

export interface SavedPrompt {
  id:        string
  name:      string
  /** Prompt body — may contain {{variable_name}} placeholders */
  content:   string
  tags?:     string[]
  createdAt: number
  updatedAt: number
}

// ─── IPC channel names ─────────────────────────────────────────────────────

export const IPC = {
  GET_SETTINGS:       'settings:get',
  SAVE_SETTINGS:      'settings:save',
  CHAT_SEND:          'chat:send',
  CHAT_ABORT:         'chat:abort',
  CONV_LIST:          'conv:list',
  CONV_SAVE:          'conv:save',
  CONV_DELETE:        'conv:delete',
  STREAM_CHUNK:       'stream:chunk',
  STREAM_DONE:        'stream:done',
  STREAM_ERROR:       'stream:error',
  SET_TITLEBAR_THEME: 'window:setTitleBarTheme',
  EXPORT_CHAT:        'chat:export',
  PICK_FOLDER:            'dialog:pickFolder',
  OPENROUTER_GET_MODELS:  'openrouter:getModels',
  OPENAI_GET_MODELS:      'openai:getModels',
  TOOL_CALL_START:    'tool:start',
  TOOL_CALL_RESULT:   'tool:result',
  TOOL_OUTPUT_CHUNK:  'tool:outputChunk',
  DIFF_REQUEST:       'diff:request',
  DIFF_RESPONSE:      'diff:response',
  DIFF_ATTACH:        'diff:attach',
  WORKSPACE_INDEXED:  'workspace:indexed',
  GIT_STATUS_GET:     'git:statusGet',
  // Auto-updater
  UPDATE_STATUS:      'update:status',
  UPDATE_CHECK:       'update:check',
  UPDATE_DOWNLOAD:    'update:download',
  UPDATE_INSTALL:     'update:install',
  // Terminal / PTY
  TERMINAL_CREATE:  'terminal:create',    // create PTY session
  TERMINAL_WRITE:   'terminal:write',     // send keystrokes to PTY
  TERMINAL_RESIZE:  'terminal:resize',    // resize PTY
  TERMINAL_KILL:    'terminal:kill',      // kill session
  TERMINAL_DATA:    'terminal:data',      // PTY output → renderer (push)
  TERMINAL_EXIT:    'terminal:exit',      // PTY exited (push)
  // Semantic / embedding index
  SEMANTIC_INDEX_BUILD:   'semantic:buildBm25',     // trigger BM25 index build
  SEMANTIC_INDEX_STATUS:  'semantic:status',        // push progress to renderer
  SEMANTIC_INDEX_INFO:    'semantic:info',          // get index metadata
  SEMANTIC_GET_FILES:     'semantic:getFiles',      // get all workspace file contents
  SEMANTIC_SAVE_EMBEDDINGS: 'semantic:saveEmbed',   // save dense embedding index from renderer
  SEMANTIC_VECTOR_SEARCH: 'semantic:vectorSearch',  // search by vector (from renderer)
  // Workspace file access
  WORKSPACE_LIST_FILES:   'workspace:listFiles',    // list all workspace file paths (no content)
  WORKSPACE_READ_FILE:    'workspace:readFile',     // read a single workspace file
  // Project memory
  MEMORY_READ:            'memory:read',            // read .ai-memory/notes.md
  MEMORY_WRITE:           'memory:write',           // write .ai-memory/notes.md
  // Project summary
  SUMMARY_READ:           'summary:read',           // read .ai-context/PROJECT.md
  SUMMARY_WRITE:          'summary:write',          // write .ai-context/PROJECT.md
  // Context compression
  CONTEXT_COMPRESSING:    'context:compressing',    // push — notifies renderer compression started
  // Session change summary + snapshots
  SESSION_CHANGES:        'session:changes',        // push — files changed during this turn
  CHECKPOINT_RESTORE:     'checkpoint:restore',     // invoke — restore a snapshot
  // Global memory
  GLOBAL_MEMORY_READ:     'globalMemory:read',      // invoke — read userData/global-memory.md
  GLOBAL_MEMORY_WRITE:    'globalMemory:write',     // invoke — write userData/global-memory.md
  // Per-project config
  PROJECT_CONFIG_READ:    'project:configRead',     // invoke — read .chatui from workspace
  // Prompt library
  PROMPT_LIST:            'prompts:list',           // invoke — list all saved prompts
  PROMPT_SAVE:            'prompts:save',           // invoke — create or update a prompt
  PROMPT_DELETE:          'prompts:delete',         // invoke — delete a prompt by id
  // Shell command approval
  CMD_APPROVAL_REQUEST:   'cmd:approvalRequest',    // push  — AI wants to run a command (shows modal)
  CMD_APPROVAL_PENDING:   'cmd:approvalPending',    // push  — links approvalId to a tool callId
  CMD_APPROVAL_RESPONSE:  'cmd:approvalResponse',   // invoke — user approved/rejected
  KILL_COMMAND:           'cmd:kill',               // invoke — kill a running shell command by callId
  // Auto-title conversations
  CONV_AUTO_TITLE:        'conv:autoTitle',          // invoke — generate title from first msg
  // Pinned context files
  PINS_READ:              'pins:read',              // invoke — read .ai-context/pins.json
  PINS_WRITE:             'pins:write',             // invoke — write .ai-context/pins.json
  // Inline file editor
  WORKSPACE_WRITE_FILE:   'workspace:writeFile',    // invoke — write a file in the workspace
  WORKSPACE_DELETE_FILE:  'workspace:deleteFile',   // invoke — delete a file or empty dir
  WORKSPACE_RENAME_FILE:  'workspace:renameFile',   // invoke — rename/move a file or dir
  WORKSPACE_NEW_FOLDER:   'workspace:newFolder',    // invoke — create a new directory
  // Custom tool plugins
  PLUGINS_LIST:           'plugins:list',           // invoke — list loaded .ai-context/tools/*.js plugins
  // Scheduled tasks
  SCHEDULE_LIST:          'schedule:list',
  SCHEDULE_CREATE:        'schedule:create',
  SCHEDULE_DELETE:        'schedule:delete',
  SCHEDULE_RUN:           'schedule:run',
  // GitHub integration
  GITHUB_DETECT_REPO:     'github:detectRepo',
  GITHUB_LIST_PRS:        'github:listPRs',
  GITHUB_CREATE_PR:       'github:createPR',
  GITHUB_LIST_ISSUES:     'github:listIssues',
  GITHUB_CREATE_ISSUE:    'github:createIssue',
  // Code execution sandbox
  CODE_EXEC:              'code:exec',
  // Agent presets
  PRESET_LIST:          'preset:list',
  PRESET_SAVE:          'preset:save',
  PRESET_DELETE:        'preset:delete',
  // Image generation
  IMAGE_GEN:            'image:gen',
  // Local HTTP API server
  API_SERVER_TOGGLE:    'api:serverToggle',
  API_SERVER_STATUS:    'api:serverStatus',
  // Ollama model detection
  OLLAMA_LIST_MODELS:   'ollama:listModels',
  // MCP servers
  MCP_LIST_SERVERS:     'mcp:listServers',
  MCP_TEST_SERVER:      'mcp:testServer',
  MCP_STOP_SERVER:      'mcp:stopServer',
  // MCP OAuth
  MCP_OAUTH_START:      'mcp:oauthStart',   // invoke — start OAuth PKCE flow
  MCP_OAUTH_REFRESH:    'mcp:oauthRefresh', // invoke — refresh an existing token
  MCP_OAUTH_REVOKE:     'mcp:oauthRevoke',  // invoke — clear saved token
  // OpenAI OAuth (Sign in with OpenAI / ChatGPT subscription)
  OPENAI_OAUTH_LOGIN:   'openai:oauthLogin',   // invoke — start browser login
  OPENAI_OAUTH_REFRESH: 'openai:oauthRefresh', // invoke — refresh access token
  OPENAI_OAUTH_LOGOUT:  'openai:oauthLogout',  // invoke — clear stored token
  // RAG injection notification
  RAG_INJECTED:         'rag:injected',
  // Jira integration
  JIRA_LIST_PROJECTS:   'jira:listProjects',
  JIRA_LIST_ISSUES:     'jira:listIssues',
  JIRA_CREATE_ISSUE:    'jira:createIssue',
  // Linear integration
  LINEAR_LIST_ISSUES:   'linear:listIssues',
  LINEAR_CREATE_ISSUE:  'linear:createIssue',
  // Conversation import
  CONV_IMPORT:          'conv:import',
  // Webhook test
  WEBHOOK_TEST:         'webhook:test',
  // Voice mode
  VOICE_TRANSCRIBE:     'voice:transcribe',
  VOICE_TTS:            'voice:tts',
  // File watcher (Pair mode)
  FILE_WATCH_START:     'fileWatch:start',
  FILE_WATCH_STOP:      'fileWatch:stop',
  FILE_WATCH_CHANGE:    'fileWatch:change',
  // Review mode
  REVIEW_GET_CHANGES:   'review:getChanges',
  // Settings backup
  SETTINGS_EXPORT:      'settings:export',
  SETTINGS_IMPORT:      'settings:import',
  // Conversation backup
  CONV_EXPORT_ALL:      'conv:exportAll',
  CONV_IMPORT_ALL:      'conv:importAll',
  // Optional dependency check
  CHECK_OPTIONAL_DEPS:  'tools:checkDeps',
  // Log viewer
  LOG_READ:             'log:read',       // invoke — returns last N log entries
  LOG_GET_PATH:         'log:getPath',    // invoke — returns path to current log file
  // Database browser
  DB_QUERY:             'db:query',       // invoke — run a SQL query, returns markdown table
  DB_LIST_TABLES:       'db:listTables',  // invoke — list tables and row counts
  // Test runner
  TEST_RUN:             'test:run',       // invoke — start a test run
  TEST_ABORT:           'test:abort',     // invoke — kill the running test process
  TEST_CHUNK:           'test:chunk',     // push  — streaming output chunk
  TEST_DONE:            'test:done',      // push  — test run finished
  TEST_WATCH_TOGGLE:    'test:watchToggle', // invoke — start/stop file-change watcher
  TEST_WATCH_FIRED:     'test:watchFired',  // push  — file changed, auto-rerun triggered
  // Playwright
  PLAYWRIGHT_OPEN_REPORT: 'playwright:openReport', // invoke — open HTML report in browser
  // Docker manager
  DOCKER_CHECK:           'docker:check',           // invoke — check if Docker daemon is running
  DOCKER_LIST_CONTAINERS: 'docker:listContainers',  // invoke — list all containers
  DOCKER_LIST_IMAGES:     'docker:listImages',      // invoke — list all images
  DOCKER_LIST_VOLUMES:    'docker:listVolumes',     // invoke — list all volumes
  DOCKER_CONTAINER_ACTION:'docker:containerAction', // invoke — start/stop/restart/remove/pause
  DOCKER_GET_LOGS:        'docker:getLogs',         // invoke — get recent logs (static)
  DOCKER_STREAM_LOGS:     'docker:streamLogs',      // invoke — start streaming logs
  DOCKER_STOP_LOGS:       'docker:stopLogs',        // invoke — stop streaming logs
  DOCKER_LOG_CHUNK:       'docker:logChunk',        // push   — log chunk from streaming
  DOCKER_IMAGE_ACTION:    'docker:imageAction',     // invoke — remove image
  DOCKER_VOLUME_ACTION:   'docker:volumeAction',    // invoke — remove volume
  DOCKER_STATS:           'docker:stats',           // invoke — get container CPU/mem stats

  // ── Dependency Audit ─────────────────────────────────────────────────────
  DEP_AUDIT:              'dep:audit',              // invoke — run audit in workspace

  // ── Inline code completions ───────────────────────────────────────────────
  COMPLETION_REQUEST:     'completion:request',     // invoke — AI inline completion for editor

  // ── Git commit helpers ────────────────────────────────────────────────────
  GIT_STAGED_DIFF:        'git:stagedDiff',         // invoke — get staged diff text
  GIT_GENERATE_MSG:       'git:generateMsg',        // invoke — AI-generate a commit message
  GIT_DO_COMMIT:          'git:doCommit',           // invoke — run git commit -m
  // URL pre-fetch (renderer → main, bypasses CORS via net.fetch)
  URL_FETCH:              'url:fetch',              // invoke — fetch URL, return cleaned text
  GIT_STAGE_ALL:          'git:stageAll',           // invoke — git add -A
  // Clipboard
  CLIPBOARD_READ_IMAGE:   'clipboard:readImage',    // invoke — read image from clipboard as base64
} as const

// ── Docker types ──────────────────────────────────────────────────────────────
export interface DockerContainer {
  id:         string
  name:       string
  image:      string
  state:      string   // running | exited | paused | created | restarting | dead
  status:     string   // human-readable e.g. "Up 2 hours"
  ports:      string
  createdAt:  string
  runningFor: string
}

export interface DockerImage {
  id:         string
  repository: string
  tag:        string
  size:       string
  createdAt:  string
}

export interface DockerVolume {
  name:       string
  driver:     string
  mountpoint: string
}

export interface DockerStats {
  cpuPct:   string
  memUsage: string
  memPct:   string
  netIO:    string
  blockIO:  string
  pids:     string
}

// ── Dependency Audit types ─────────────────────────────────────────────────────
export type AuditSeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info'

export interface AuditVulnerability {
  name:       string       // package name
  severity:   AuditSeverity
  title:      string       // short description
  url:        string       // advisory URL
  range:      string       // vulnerable version range
  fixedIn:    string       // version that fixes it
  via:        string[]     // dependency chain
  isDirect:   boolean
}

export interface AuditResult {
  manager:   'npm' | 'yarn' | 'pnpm' | 'pip' | 'cargo'
  total:     number
  critical:  number
  high:      number
  moderate:  number
  low:       number
  info:      number
  vulns:     AuditVulnerability[]
  raw:       string        // raw CLI output for "Ask AI"
}

export interface ScheduledTask {
  id:        string
  name:      string
  prompt:    string
  schedule:  string  // cron expression
  enabled:   boolean
  createdAt: number
  lastRun?:  number
}

// ─── Agent Presets ─────────────────────────────────────────────────────────

export interface AgentPreset {
  id:           string
  name:         string
  provider:     Provider
  model:        string
  systemPrompt: string
  maxTokens:    number
  temperature?: number
  topP?:        number
  createdAt:    number
}

// ─── MCP OAuth ─────────────────────────────────────────────────────────────

/** OAuth 2.0 + PKCE configuration for a remote MCP server */
export interface McpOAuthConfig {
  authorizationUrl: string   // e.g. https://auth.example.com/oauth/authorize
  tokenUrl:         string   // e.g. https://auth.example.com/oauth/token
  clientId:         string
  clientSecret?:    string   // optional — PKCE-only flows
  scopes:           string   // space-separated, e.g. "read write"
}

/** Persisted token set for a remote MCP server */
export interface McpOAuthToken {
  accessToken:   string
  refreshToken?: string
  expiresAt?:    number   // Unix ms — undefined = non-expiring
  tokenType:     string
  scope?:        string
}

// ─── MCP Server Config ──────────────────────────────────────────────────────

export interface McpServerConfig {
  id:      string
  name:    string
  enabled: boolean

  // ── stdio (local process) ────────────────────────────────────────────────
  serverType?: 'stdio' | 'remote'   // default 'stdio'
  command?:    string               // required for stdio
  args?:       string[]
  env?:        Record<string, string>

  // ── remote (HTTP / SSE) ──────────────────────────────────────────────────
  serverUrl?:       string          // required for remote, e.g. https://api.example.com/mcp
  requireApproval?: boolean         // if false, pass require_approval:"never" to OpenAI
  oauth?:           McpOAuthConfig  // OAuth config — present = auth required
  oauthToken?:      McpOAuthToken   // stored access token (after user connects)
}

export interface McpTool {
  name:        string
  description: string
  inputSchema: Record<string, unknown>
}

export interface GitStatusSummary {
  isRepo:     boolean
  branch:     string
  ahead:      number
  behind:     number
  staged:     number
  unstaged:   number
  untracked:  number
  isClean:    boolean
}

export interface ExportChatPayload {
  defaultName: string   // suggested filename without extension
  content:     string   // full file content
  format:      'md' | 'txt' | 'json'
}

// ─── Image attachments ─────────────────────────────────────────────────────

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export interface ImageAttachment {
  mimeType: ImageMimeType
  data:     string   // base64-encoded bytes (no data URI prefix)
}

// ─── IPC payloads ──────────────────────────────────────────────────────────

export interface ChatSendPayload {
  conversationId: string
  messages: { role: MessageRole; content: string; images?: ImageAttachment[] }[]
  settings: AppSettings
  mode?: ConversationMode
  workspacePath?: string  // per-conversation folder override
}

/** Model prefixes/names that support extended reasoning / thinking */
export const REASONING_CAPABLE_MODELS: Record<string, string[]> = {
  // Anthropic — extended thinking (budget_tokens)
  anthropic: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4', 'claude-3-7'],
  // OpenAI — reasoning_effort param (o-series only)
  openai:    ['o1', 'o3', 'o4'],
  // Gemini — thinkingConfig.thinkingBudget
  gemini:    ['gemini-2.5', 'gemini-3.1'],
  // nvidia / custom — not supported
  nvidia:    [],
  custom:    [],
}

/** Returns true when the given provider+model supports reasoning depth control */
export function supportsReasoningDepth(provider: string, model: string): boolean {
  const prefixes = REASONING_CAPABLE_MODELS[provider] ?? []
  return prefixes.some(p => model.startsWith(p))
}

export interface StreamChunkPayload {
  conversationId: string
  chunk: string
}

export interface StreamDonePayload {
  conversationId: string
  fullText: string
}

export interface StreamErrorPayload {
  conversationId: string
  error: string
}

export interface ToolCallStartPayload {
  conversationId: string
  callId:         string
  name:           string
  input:          Record<string, unknown>
}

export interface ToolCallResultPayload {
  conversationId: string
  callId:         string
  output:         string
  isError:        boolean
}

export interface ContextCompressingPayload {
  conversationId: string
}

export interface SessionChangesPayload {
  conversationId: string
  files:          ChangedFile[]
  snapshotId?:    string    // set when a file backup was created this turn
}

export interface SnapshotInfo {
  id:        string
  timestamp: number
  fileCount: number
}

export interface ToolOutputChunkPayload {
  conversationId: string
  callId:         string
  chunk:          string
}

export interface DiffRequestPayload {
  id:     string   // unique approval id
  path:   string   // relative path shown to user
  before: string   // current file content (empty string = new file)
  after:  string   // proposed content
  isNew:  boolean  // true if file doesn't exist yet
}

export interface DiffResponsePayload {
  id:       string
  approved: boolean
  content?: string   // optional modified content (for hunk-level partial accept)
}

export interface DiffAttachPayload {
  diffId:  string
  callId:  string
  payload: DiffRequestPayload
}

export interface WorkspaceIndexPayload {
  summary: string  // compact text injected into system prompt
}

// ─── Auto-updater ──────────────────────────────────────────────────────────

export type UpdateStatusPayload =
  | { type: 'checking' }
  | { type: 'available';    version: string }
  | { type: 'not-available' }
  | { type: 'downloading';  percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { type: 'downloaded';   version: string }
  | { type: 'error';        message: string }

// ─── Semantic / embedding index ────────────────────────────────────────────

export interface SemanticIndexStatusPayload {
  phase:   'scanning' | 'indexing' | 'done' | 'error'
  done:    number
  total:   number
  message: string
}

export interface SemanticIndexInfo {
  exists:        boolean
  chunkCount:    number
  fileCount:     number
  createdAt:     number
  hasEmbeddings: boolean
}

export interface WorkspaceFilePayload {
  path:    string
  content: string
}

export interface EmbeddingChunkPayload {
  path:      string
  startLine: number
  endLine:   number
  text:      string
  embedding: number[]
}

export interface SaveEmbeddingsPayload {
  version:    1
  workspace:  string
  createdAt:  number
  fileCount:  number
  chunkCount: number
  chunks:     EmbeddingChunkPayload[]
}

export interface SemanticSearchResult {
  path:      string
  startLine: number
  endLine:   number
  excerpt:   string
  score:     number
}

export interface JiraProject {
  id:   string
  key:  string
  name: string
}

export interface JiraIssue {
  id:          string
  key:         string
  summary:     string
  status:      string
  priority:    string
  assignee:    string | null
  issueType:   string
  created:     string
  url:         string
}

export interface LinearIssue {
  id:          string
  identifier:  string
  title:       string
  state:       string
  priority:    number
  assignee:    string | null
  url:         string
  createdAt:   string
}
