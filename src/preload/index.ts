import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  AppSettings,
  Conversation,
  ChatSendPayload,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  RateLimitRetryPayload,
  ExportChatPayload,
  ToolCallStartPayload,
  ToolCallResultPayload,
  ToolOutputChunkPayload,
  ContextCompressingPayload,
  SessionChangesPayload,
  DiffRequestPayload,
  DiffResponsePayload,
  DiffAttachPayload,
  GitStatusSummary,
  UpdateStatusPayload,
  SemanticIndexStatusPayload,
  SemanticIndexInfo,
  WorkspaceFilePayload,
  SaveEmbeddingsPayload,
  SemanticSearchResult,
  ProjectConfig,
  SavedPrompt,
  CmdApprovalPayload,
  AgentPreset,
  McpServerConfig,
  McpOAuthConfig,
  McpOAuthToken,
  McpTool,
  JiraProject,
  JiraIssue,
  LinearIssue,
  AuditResult,
} from '../shared/types'

const api = {
  // Platform info (exposed synchronously — safe, no IPC needed)
  platform: process.platform as 'win32' | 'darwin' | 'linux',

  // Settings
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.GET_SETTINGS),

  saveSettings: (settings: AppSettings): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),

  // Conversations
  listConversations: (): Promise<Conversation[]> =>
    ipcRenderer.invoke(IPC.CONV_LIST),

  saveConversation: (conv: Conversation): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.CONV_SAVE, conv),

  deleteConversation: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.CONV_DELETE, id),

  // Chat
  sendMessage: (payload: ChatSendPayload): Promise<void> =>
    ipcRenderer.invoke(IPC.CHAT_SEND, payload),

  abortMessage: (conversationId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.CHAT_ABORT, conversationId),

  // Stream listeners
  onStreamChunk: (callback: (payload: StreamChunkPayload) => void) => {
    ipcRenderer.on(IPC.STREAM_CHUNK, (_e, payload) => callback(payload))
  },
  onStreamDone: (callback: (payload: StreamDonePayload) => void) => {
    ipcRenderer.on(IPC.STREAM_DONE, (_e, payload) => callback(payload))
  },
  onStreamError: (callback: (payload: StreamErrorPayload) => void) => {
    ipcRenderer.on(IPC.STREAM_ERROR, (_e, payload) => callback(payload))
  },
  onRateLimitRetry: (callback: (payload: RateLimitRetryPayload) => void) => {
    ipcRenderer.on(IPC.RATE_LIMIT_RETRY, (_e, payload) => callback(payload))
  },

  // Tool call listeners
  onToolCallStart: (callback: (payload: ToolCallStartPayload) => void) => {
    ipcRenderer.on(IPC.TOOL_CALL_START, (_e, payload) => callback(payload))
  },
  onToolCallResult: (callback: (payload: ToolCallResultPayload) => void) => {
    ipcRenderer.on(IPC.TOOL_CALL_RESULT, (_e, payload) => callback(payload))
  },
  onToolOutputChunk: (callback: (payload: ToolOutputChunkPayload) => void) => {
    ipcRenderer.on(IPC.TOOL_OUTPUT_CHUNK, (_e, payload) => callback(payload))
  },

  onContextCompressing: (callback: (payload: ContextCompressingPayload) => void) => {
    ipcRenderer.on(IPC.CONTEXT_COMPRESSING, (_e, payload) => callback(payload))
  },

  onSessionChanges: (callback: (payload: SessionChangesPayload) => void) => {
    ipcRenderer.on(IPC.SESSION_CHANGES, (_e, payload) => callback(payload))
  },

  // Remove all stream + tool listeners (call on component unmount)
  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners(IPC.STREAM_CHUNK)
    ipcRenderer.removeAllListeners(IPC.STREAM_DONE)
    ipcRenderer.removeAllListeners(IPC.STREAM_ERROR)
    ipcRenderer.removeAllListeners(IPC.TOOL_CALL_START)
    ipcRenderer.removeAllListeners(IPC.TOOL_CALL_RESULT)
    ipcRenderer.removeAllListeners(IPC.TOOL_OUTPUT_CHUNK)
    ipcRenderer.removeAllListeners(IPC.CONTEXT_COMPRESSING)
    ipcRenderer.removeAllListeners(IPC.SESSION_CHANGES)
    // NOTE: CMD_APPROVAL_REQUEST is intentionally NOT cleared here.
    // App.tsx registers a persistent app-level listener for the modal; removing
    // it on every stream end would break approval after the first message.
  },

  // Window title bar
  setTitleBarTheme: (theme: 'dark' | 'light'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.SET_TITLEBAR_THEME, theme),

  // Export chat
  exportChat: (payload: ExportChatPayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.EXPORT_CHAT, payload),

  // Clipboard — read image via Electron native clipboard (renderer File objects are unreliable)
  clipboardReadImage: (): Promise<{ dataUrl: string; base64: string; size: number } | null> =>
    ipcRenderer.invoke(IPC.CLIPBOARD_READ_IMAGE),

  // Folder picker
  pickFolder: (): Promise<{ path: string | null }> =>
    ipcRenderer.invoke(IPC.PICK_FOLDER),

  // URL pre-fetch — fetches a URL via main-process net.fetch (bypasses CORS)
  fetchUrlContent: (url: string): Promise<{
    ok: boolean
    content: string
    error?: string
  }> => ipcRenderer.invoke(IPC.URL_FETCH, url),

  // OpenAI — fetch live model list from /v1/models (chat models only)
  getOpenAIModels: (apiKey: string): Promise<{
    ok: boolean
    models: string[]
    error?: string
  }> => ipcRenderer.invoke(IPC.OPENAI_GET_MODELS, apiKey),

  // OpenRouter — fetch available models (sorted: free first, then paid alphabetically)
  getOpenRouterModels: (apiKey?: string): Promise<{
    ok: boolean
    models: Array<{ id: string; name: string; contextLength: number; isFree: boolean; promptPrice: string }>
    error?: string
  }> => ipcRenderer.invoke(IPC.OPENROUTER_GET_MODELS, apiKey),

  // Diff viewer — renderer listens for requests, sends back approval
  onDiffRequest: (callback: (payload: DiffRequestPayload) => void) => {
    ipcRenderer.on(IPC.DIFF_REQUEST, (_e, payload) => callback(payload))
  },
  onDiffAttach: (callback: (payload: DiffAttachPayload) => void) => {
    ipcRenderer.on(IPC.DIFF_ATTACH, (_e, payload) => callback(payload))
  },
  respondDiff: (payload: DiffResponsePayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.DIFF_RESPONSE, payload),

  // Shell command approval
  onCmdApproval: (callback: (payload: CmdApprovalPayload) => void) => {
    ipcRenderer.on(IPC.CMD_APPROVAL_REQUEST, (_e, payload) => callback(payload))
  },
  respondCmdApproval: (id: string, approved: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.CMD_APPROVAL_RESPONSE, id, approved),
  killCommand: (callId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.KILL_COMMAND, callId),

  // Git status for UI
  getGitStatus: (workspacePath: string): Promise<GitStatusSummary> =>
    ipcRenderer.invoke(IPC.GIT_STATUS_GET, workspacePath),

  // Git commit helpers
  gitStagedDiff: (workspacePath: string): Promise<{ ok: boolean; diff: string; error?: string }> =>
    ipcRenderer.invoke(IPC.GIT_STAGED_DIFF, workspacePath),
  gitStageAll: (workspacePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.GIT_STAGE_ALL, workspacePath),
  gitGenerateMsg: (workspacePath: string, settings: import('../shared/types').AppSettings): Promise<{ ok: boolean; message?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.GIT_GENERATE_MSG, workspacePath, settings),
  gitDoCommit: (workspacePath: string, message: string): Promise<{ ok: boolean; output: string }> =>
    ipcRenderer.invoke(IPC.GIT_DO_COMMIT, workspacePath, message),

  // Terminal / PTY
  createTerminal: (workspacePath: string, cols: number, rows: number): Promise<{ sessionId: string; error?: string }> =>
    ipcRenderer.invoke(IPC.TERMINAL_CREATE, workspacePath, cols, rows),
  writeTerminal: (sessionId: string, data: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.TERMINAL_WRITE, sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.TERMINAL_RESIZE, sessionId, cols, rows),
  killTerminal: (sessionId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.TERMINAL_KILL, sessionId),
  onTerminalData: (callback: (payload: { sessionId: string; data: string }) => void) => {
    ipcRenderer.on(IPC.TERMINAL_DATA, (_e, payload) => callback(payload))
  },
  onTerminalExit: (callback: (payload: { sessionId: string; exitCode: number }) => void) => {
    ipcRenderer.on(IPC.TERMINAL_EXIT, (_e, payload) => callback(payload))
  },
  removeTerminalListeners: () => {
    ipcRenderer.removeAllListeners(IPC.TERMINAL_DATA)
    ipcRenderer.removeAllListeners(IPC.TERMINAL_EXIT)
  },

  // Auto-updater
  onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => {
    ipcRenderer.on(IPC.UPDATE_STATUS, (_e, payload) => callback(payload))
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners(IPC.UPDATE_STATUS)
  },
  checkForUpdates: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.UPDATE_CHECK),
  downloadUpdate: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
  installUpdate: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.UPDATE_INSTALL),

  // Semantic / BM25 / embedding index
  buildSemanticIndex: (workspacePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SEMANTIC_INDEX_BUILD, workspacePath),

  getSemanticIndexInfo: (workspacePath: string): Promise<SemanticIndexInfo> =>
    ipcRenderer.invoke(IPC.SEMANTIC_INDEX_INFO, workspacePath),

  onSemanticIndexStatus: (callback: (payload: SemanticIndexStatusPayload) => void) => {
    ipcRenderer.on(IPC.SEMANTIC_INDEX_STATUS, (_e, payload) => callback(payload))
  },
  removeSemanticListeners: () => {
    ipcRenderer.removeAllListeners(IPC.SEMANTIC_INDEX_STATUS)
  },

  getWorkspaceFiles: (workspacePath: string): Promise<WorkspaceFilePayload[]> =>
    ipcRenderer.invoke(IPC.SEMANTIC_GET_FILES, workspacePath),

  saveEmbeddingIndex: (payload: SaveEmbeddingsPayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.SEMANTIC_SAVE_EMBEDDINGS, payload),

  vectorSearch: (workspacePath: string, vector: number[], topK: number): Promise<SemanticSearchResult[]> =>
    ipcRenderer.invoke(IPC.SEMANTIC_VECTOR_SEARCH, workspacePath, vector, topK),

  // Workspace file access — for @-mention in chat
  listWorkspaceFiles: (workspacePath: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC.WORKSPACE_LIST_FILES, workspacePath),

  readWorkspaceFile: (workspacePath: string, relativePath: string): Promise<{ content: string; error?: string }> =>
    ipcRenderer.invoke(IPC.WORKSPACE_READ_FILE, workspacePath, relativePath),

  // Project memory
  readMemory:  (workspacePath: string): Promise<{ content: string }> =>
    ipcRenderer.invoke(IPC.MEMORY_READ, workspacePath),
  saveMemory:  (workspacePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.MEMORY_WRITE, workspacePath, content),

  // Project summary
  readSummary: (workspacePath: string): Promise<{ content: string; updatedAt: number }> =>
    ipcRenderer.invoke(IPC.SUMMARY_READ, workspacePath),
  saveSummary: (workspacePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SUMMARY_WRITE, workspacePath, content),

  // Checkpoint / snapshot restore
  restoreSnapshot: (workspace: string, snapshotId: string): Promise<{ ok: boolean; restoredCount: number; error?: string }> =>
    ipcRenderer.invoke(IPC.CHECKPOINT_RESTORE, workspace, snapshotId),

  // Global memory
  readGlobalMemory:  (): Promise<{ content: string }> =>
    ipcRenderer.invoke(IPC.GLOBAL_MEMORY_READ),
  saveGlobalMemory:  (content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.GLOBAL_MEMORY_WRITE, content),

  // Per-project .chatui config
  getProjectConfig: (workspacePath: string): Promise<ProjectConfig | null> =>
    ipcRenderer.invoke(IPC.PROJECT_CONFIG_READ, workspacePath),

  // Prompt library
  listPrompts:   (): Promise<SavedPrompt[]> =>
    ipcRenderer.invoke(IPC.PROMPT_LIST),
  savePrompt:    (prompt: SavedPrompt): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.PROMPT_SAVE, prompt),
  deletePrompt:  (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.PROMPT_DELETE, id),

  // Auto-title
  autoTitleConversation: (firstUserMsg: string, settings: AppSettings): Promise<{ ok: boolean; title?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.CONV_AUTO_TITLE, firstUserMsg, settings),

  // Pinned context files
  readPins:  (workspacePath: string): Promise<{ pins: string[] }> =>
    ipcRenderer.invoke(IPC.PINS_READ, workspacePath),
  savePins:  (workspacePath: string, pins: string[]): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.PINS_WRITE, workspacePath, pins),

  // Inline file editor
  writeWorkspaceFile: (workspacePath: string, relativePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WORKSPACE_WRITE_FILE, workspacePath, relativePath, content),

  deleteWorkspaceFile: (workspacePath: string, relativePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WORKSPACE_DELETE_FILE, workspacePath, relativePath),

  renameWorkspaceFile: (workspacePath: string, oldRelPath: string, newRelPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WORKSPACE_RENAME_FILE, workspacePath, oldRelPath, newRelPath),

  newWorkspaceFolder: (workspacePath: string, relativePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WORKSPACE_NEW_FOLDER, workspacePath, relativePath),

  // Custom tool plugins
  listPlugins: (workspacePath: string): Promise<{ name: string; description: string; file: string }[]> =>
    ipcRenderer.invoke(IPC.PLUGINS_LIST, workspacePath),

  // Scheduled tasks
  listScheduledTasks:   (): Promise<import('../shared/types').ScheduledTask[]> =>
    ipcRenderer.invoke(IPC.SCHEDULE_LIST),
  createScheduledTask:  (task: Omit<import('../shared/types').ScheduledTask, 'id' | 'createdAt'>): Promise<{ ok: boolean; id?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.SCHEDULE_CREATE, task),
  deleteScheduledTask:  (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.SCHEDULE_DELETE, id),
  runScheduledTask:     (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SCHEDULE_RUN, id),
  // GitHub integration
  githubDetectRepo:     (workspacePath: string): Promise<{ owner: string; repo: string; defaultBranch: string } | null> =>
    ipcRenderer.invoke(IPC.GITHUB_DETECT_REPO, workspacePath),
  githubListPRs:        (owner: string, repo: string, token: string): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.GITHUB_LIST_PRS, owner, repo, token),
  githubCreatePR:       (params: unknown, token: string): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.GITHUB_CREATE_PR, params, token),
  githubListIssues:     (owner: string, repo: string, token: string): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC.GITHUB_LIST_ISSUES, owner, repo, token),
  githubCreateIssue:    (params: unknown, token: string): Promise<{ ok: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.GITHUB_CREATE_ISSUE, params, token),
  // Code execution sandbox
  execCode:             (language: string, code: string): Promise<{ ok: boolean; output: string; error?: string }> =>
    ipcRenderer.invoke(IPC.CODE_EXEC, language, code),
  // Scheduled task fire listener
  onScheduleFire:       (cb: (payload: { taskId: string; prompt: string }) => void) =>
    ipcRenderer.on('schedule:fire', (_e, payload) => cb(payload)),

  // Agent presets
  listPresets:   (): Promise<AgentPreset[]> =>
    ipcRenderer.invoke(IPC.PRESET_LIST),
  savePreset:    (preset: AgentPreset): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.PRESET_SAVE, preset),
  deletePreset:  (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.PRESET_DELETE, id),

  // Image generation
  generateImage: (prompt: string, settings: AppSettings): Promise<{ ok: boolean; url?: string; b64?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.IMAGE_GEN, prompt, settings),

  // HTTP API server
  toggleApiServer: (enabled: boolean, port: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.API_SERVER_TOGGLE, enabled, port),
  getApiServerStatus: (): Promise<{ running: boolean; port: number }> =>
    ipcRenderer.invoke(IPC.API_SERVER_STATUS),

  // Ollama model detection
  listOllamaModels: (): Promise<{ ok: boolean; models: string[] }> =>
    ipcRenderer.invoke(IPC.OLLAMA_LIST_MODELS),

  // MCP servers
  testMcpServer:  (config: McpServerConfig): Promise<{ ok: boolean; tools?: McpTool[]; error?: string }> =>
    ipcRenderer.invoke(IPC.MCP_TEST_SERVER, config),
  stopMcpServer:  (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.MCP_STOP_SERVER, id),
  listMcpServers: (configs: McpServerConfig[]): Promise<Array<McpServerConfig & { status: { ready: boolean; tools: number; error: string | null } }>> =>
    ipcRenderer.invoke(IPC.MCP_LIST_SERVERS, configs),

  // MCP OAuth
  startMcpOAuth: (oauthConfig: McpOAuthConfig): Promise<{ ok: boolean; token?: McpOAuthToken; error?: string }> =>
    ipcRenderer.invoke(IPC.MCP_OAUTH_START, oauthConfig),
  refreshMcpToken: (opts: { tokenUrl: string; clientId: string; clientSecret?: string; refreshToken: string }): Promise<{ ok: boolean; token?: McpOAuthToken; error?: string }> =>
    ipcRenderer.invoke(IPC.MCP_OAUTH_REFRESH, opts),
  revokeMcpToken: (clientId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.MCP_OAUTH_REVOKE, clientId),

  // OpenAI OAuth (Sign in with OpenAI — uses ChatGPT subscription)
  loginWithOpenAI: (): Promise<{ ok: boolean; token?: { accessToken: string; refreshToken?: string; expiresAt?: number; tokenType: string }; error?: string }> =>
    ipcRenderer.invoke(IPC.OPENAI_OAUTH_LOGIN),
  refreshOpenAIToken: (refreshToken: string): Promise<{ ok: boolean; token?: { accessToken: string; refreshToken?: string; expiresAt?: number; tokenType: string }; error?: string }> =>
    ipcRenderer.invoke(IPC.OPENAI_OAUTH_REFRESH, refreshToken),
  logoutOpenAI: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.OPENAI_OAUTH_LOGOUT),

  // RAG injection notification
  onRagInjected: (cb: (payload: { chunks: number }) => void) =>
    ipcRenderer.on(IPC.RAG_INJECTED, (_e, payload) => cb(payload)),

  // Jira integration
  jiraListProjects: (jiraUrl: string, email: string, token: string): Promise<{ ok: boolean; projects?: JiraProject[]; error?: string }> =>
    ipcRenderer.invoke(IPC.JIRA_LIST_PROJECTS, jiraUrl, email, token),
  jiraListIssues: (jiraUrl: string, email: string, token: string, projectKey: string): Promise<{ ok: boolean; issues?: JiraIssue[]; error?: string }> =>
    ipcRenderer.invoke(IPC.JIRA_LIST_ISSUES, jiraUrl, email, token, projectKey),
  jiraCreateIssue: (jiraUrl: string, email: string, token: string, params: { projectKey: string; summary: string; description: string; issueType: string }): Promise<{ ok: boolean; key?: string; url?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.JIRA_CREATE_ISSUE, jiraUrl, email, token, params),

  // Linear integration
  linearListIssues: (linearToken: string, teamId?: string): Promise<{ ok: boolean; issues?: LinearIssue[]; error?: string }> =>
    ipcRenderer.invoke(IPC.LINEAR_LIST_ISSUES, linearToken, teamId),
  linearCreateIssue: (linearToken: string, params: { teamId: string; title: string; description: string; priority?: number }): Promise<{ ok: boolean; identifier?: string; url?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.LINEAR_CREATE_ISSUE, linearToken, params),

  // Conversation import
  importConversation: (filePath: string): Promise<{ ok: boolean; conversation?: Conversation; error?: string }> =>
    ipcRenderer.invoke(IPC.CONV_IMPORT, filePath),

  // Webhook test
  testWebhook: (webhookUrl: string): Promise<{ ok: boolean; status?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.WEBHOOK_TEST, webhookUrl),

  // Voice mode
  voiceTranscribe: (audioBase64: string, settings: AppSettings): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.VOICE_TRANSCRIBE, audioBase64, settings),
  voiceTTS: (text: string, settings: AppSettings): Promise<{ ok: boolean; audioBase64?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.VOICE_TTS, text, settings),

  // File watcher (Pair mode)
  startFileWatch: (workspacePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.FILE_WATCH_START, workspacePath),
  stopFileWatch: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.FILE_WATCH_STOP),
  onFileWatchChange: (cb: (payload: { changes: Array<{ path: string; type: string }> }) => void) =>
    ipcRenderer.on(IPC.FILE_WATCH_CHANGE, (_e, payload) => cb(payload)),

  // Review mode
  getReviewChanges: (workspacePath: string): Promise<{ ok: boolean; status?: string; diff?: string; staged?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.REVIEW_GET_CHANGES, workspacePath),

  // Settings export / import
  exportSettings: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SETTINGS_EXPORT),
  importSettings: (): Promise<{ ok: boolean; settings?: AppSettings; error?: string }> =>
    ipcRenderer.invoke(IPC.SETTINGS_IMPORT),

  // Conversation backup / restore
  exportAllConversations: (): Promise<{ ok: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.CONV_EXPORT_ALL),
  importAllConversations: (): Promise<{ ok: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.CONV_IMPORT_ALL),

  // Optional dependency check
  checkOptionalDeps: (): Promise<{
    playwright:    { available: boolean; version?: string }
    betterSqlite: { available: boolean; version?: string }
    pg:           { available: boolean; version?: string }
  }> =>
    ipcRenderer.invoke(IPC.CHECK_OPTIONAL_DEPS),

  // Log viewer
  getLogPath: (): Promise<string> =>
    ipcRenderer.invoke(IPC.LOG_GET_PATH),
  readLogs: (lines?: number): Promise<{ ok: boolean; entries: Array<{ ts: string; level: string; tag: string; msg: string; data?: unknown }>; error?: string }> =>
    ipcRenderer.invoke(IPC.LOG_READ, lines ?? 500),

  // Database browser
  dbQuery: (connStr: string, sql: string, workspacePath: string): Promise<{ ok: boolean; output: string }> =>
    ipcRenderer.invoke(IPC.DB_QUERY, connStr, sql, workspacePath),
  dbListTables: (connStr: string, workspacePath: string): Promise<{ ok: boolean; output: string }> =>
    ipcRenderer.invoke(IPC.DB_LIST_TABLES, connStr, workspacePath),

  // Inline code completions
  completionRequest: (payload: { prefix: string; suffix: string; language: string; settings: import('../shared/types').AppSettings }): Promise<{ ok: boolean; text: string; error?: string }> =>
    ipcRenderer.invoke(IPC.COMPLETION_REQUEST, payload),

  // Test runner
  testRun: (command: string, workspace: string, framework: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.TEST_RUN, command, workspace, framework),
  testAbort: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.TEST_ABORT),
  testWatchToggle: (enabled: boolean, workspace: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.TEST_WATCH_TOGGLE, enabled, workspace),
  testDetectFrameworks: (workspace: string): Promise<Array<{ framework: string; command: string; label: string; icon: string }>> =>
    ipcRenderer.invoke('test:detectFrameworks', workspace),
  onTestChunk: (cb: (chunk: string) => void) =>
    ipcRenderer.on(IPC.TEST_CHUNK, (_e, chunk) => cb(chunk)),
  onTestDone: (cb: (result: unknown) => void) =>
    ipcRenderer.on(IPC.TEST_DONE, (_e, result) => cb(result)),
  onTestWatchFired: (cb: (file: string) => void) =>
    ipcRenderer.on(IPC.TEST_WATCH_FIRED, (_e, file) => cb(file)),
  removeTestListeners: () => {
    ipcRenderer.removeAllListeners(IPC.TEST_CHUNK)
    ipcRenderer.removeAllListeners(IPC.TEST_DONE)
    ipcRenderer.removeAllListeners(IPC.TEST_WATCH_FIRED)
  },
  playwrightOpenReport: (workspace: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.PLAYWRIGHT_OPEN_REPORT, workspace),

  // Docker manager
  dockerCheck:           (): Promise<{ ok: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_CHECK),
  dockerListContainers:  (): Promise<{ ok: boolean; containers?: unknown[]; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_LIST_CONTAINERS),
  dockerListImages:      (): Promise<{ ok: boolean; images?: unknown[]; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_LIST_IMAGES),
  dockerListVolumes:     (): Promise<{ ok: boolean; volumes?: unknown[]; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_LIST_VOLUMES),
  dockerContainerAction: (action: string, id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_CONTAINER_ACTION, action, id),
  dockerGetLogs:         (id: string, lines?: number): Promise<{ ok: boolean; logs?: string; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_GET_LOGS, id, lines),
  dockerStreamLogs:      (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_STREAM_LOGS, id),
  dockerStopLogs:        (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.DOCKER_STOP_LOGS, id),
  dockerStats:           (id: string): Promise<{ ok: boolean; stats?: unknown; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_STATS, id),
  dockerImageAction:     (action: string, id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_IMAGE_ACTION, action, id),
  dockerVolumeAction:    (action: string, name: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.DOCKER_VOLUME_ACTION, action, name),
  onDockerLogChunk: (cb: (payload: { containerId: string; data: string }) => void) =>
    ipcRenderer.on(IPC.DOCKER_LOG_CHUNK, (_e, payload) => cb(payload)),
  removeDockerLogListeners: () =>
    ipcRenderer.removeAllListeners(IPC.DOCKER_LOG_CHUNK),

  // Dependency Audit
  runDepAudit: (workspacePath: string): Promise<{ ok: boolean; result?: AuditResult; error?: string }> =>
    ipcRenderer.invoke(IPC.DEP_AUDIT, workspacePath),
}

contextBridge.exposeInMainWorld('api', api)
export type API = typeof api
