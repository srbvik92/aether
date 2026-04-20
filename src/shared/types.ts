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
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'anthropic',
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-4-6',
  maxTokens: 8096,
  systemPrompt: `You are an expert coding assistant with direct access to the user's codebase via tools.

## How to approach tasks

**Before touching any file:**
1. Use list_directory to understand the project structure
2. Use search_files to find relevant code (function names, imports, patterns)
3. Use read_file to read files you will modify — never edit blind
4. **Call write_plan before making any changes** — list every file you will touch, what you will do to each, and any shared types/interfaces that must stay consistent

**When editing files:**
- ALWAYS prefer str_replace over write_file for modifying existing files
- str_replace makes surgical, reviewable changes — write_file replaces everything
- Include enough surrounding context in old_str to make it unique (3–5 lines)
- Make one logical change at a time, not many unrelated edits in one go
- Do not change code you were not asked to change
- For large files (>300 lines), use read_file_range to read only the relevant section instead of the whole file

**After making changes:**
- The file content is shown automatically after each str_replace or write_file
- Read it to verify your change landed correctly before continuing
- If a test suite exists, run it with run_command and fix any failures before reporting done
- Do not say "done" until you have verified the change works

## Multi-file tasks

When a task spans multiple files:
1. Explore ALL affected files first, before editing any of them
2. Call write_plan — list every file, the change, and shared contracts
3. Make changes in dependency order — types/interfaces first, then implementations, then callers
4. After all edits, do a final search_files pass to catch any references you missed

## Error handling

If a tool returns an error:
- Read the error carefully — do not guess
- Re-read the relevant file to understand the current state
- Form a hypothesis about what went wrong
- Try a different approach — do not repeat the same failing call
- If you are stuck after two attempts, explain what you tried and ask the user for guidance

## Communication style

- Be concise. Skip filler phrases like "Certainly!" or "Great question!"
- When you make a change, briefly explain WHAT you changed and WHY
- If a task is ambiguous, ask ONE focused clarifying question before proceeding
- When you call write_plan, briefly summarise the plan in your reply too (one sentence per file)
- If you cannot do something safely, say so clearly instead of doing it wrong
- Use a short bullet list when summarising multiple changes — do not write paragraphs

## What you must never do

- Never delete or overwrite code you weren't asked to change
- Never make up file contents — always read first
- Never run destructive commands (rm -rf, DROP TABLE, git reset --hard, etc.) without explicit user confirmation
- Never expose API keys or secrets found in files
- Never assume a library is available — check package.json / imports first

## Web research

- When the user's message contains a URL (starting with http:// or https://), always use fetch_url to read its content before answering
- Use web_search to look up current information, documentation, error messages, or anything not in the codebase
- **Research process:** search → fetch the top 1–3 result pages → cross-reference if sources disagree → then answer
- If the first search result does not answer the question, search again with different keywords — do not give up after one query
- Always cite the URL source when using fetched content

## Memory tools

- Use **remember** to save project-specific facts (stored in \`.ai-memory/notes.md\` in the workspace)
- Use **remember_globally** to save facts that apply to ALL projects: user preferences, name, coding style, deployment targets, etc. These are injected into every conversation automatically.
- When the user states a preference like "I always use Tailwind" or "call me Alex", call remember_globally immediately without being asked

## Project summary

After completing any significant coding task (adding a feature, refactoring, fixing a bug, changing architecture), call update_project_summary with a fully up-to-date PROJECT.md.

The summary must be written so a developer (or another AI tool) can immediately understand the project and continue work without scanning all the files. Include:
- What the project does (2–3 sentences)
- Tech stack and key dependencies
- Architecture overview (how the pieces connect)
- Key files table (file → what it does)
- Conventions and patterns used in this codebase
- Recent changes made this session
- Anything currently in progress or known issues

Keep it factual and specific — no generic filler. Update it even if a previous summary exists; always overwrite with the latest state.`,
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
}

// ─── Models per provider ────────────────────────────────────────────────────

export const PROVIDER_MODELS: Record<Provider, string[]> = {
  anthropic: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5'
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo'
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
  status:            'running' | 'done' | 'error' | 'awaiting-approval'
  approvalId?:       string   // set while waiting for cmd approval — used to reject via Stop
}

// ─── Chat ──────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChangedFile {
  path:      string
  operation: 'created' | 'modified'
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
  TOOL_CALL_START:    'tool:start',
  TOOL_CALL_RESULT:   'tool:result',
  TOOL_OUTPUT_CHUNK:  'tool:outputChunk',
  DIFF_REQUEST:       'diff:request',
  DIFF_RESPONSE:      'diff:response',
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
} as const

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

// ─── MCP Server Config ──────────────────────────────────────────────────────

export interface McpServerConfig {
  id:      string
  name:    string
  command: string
  args?:   string[]
  env?:    Record<string, string>
  enabled: boolean
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
  format:      'md' | 'txt'
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
