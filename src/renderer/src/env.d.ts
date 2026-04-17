/// <reference types="vite/client" />

import type {
  AppSettings,
  Conversation,
  ChatSendPayload,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  ExportChatPayload,
  ToolCallStartPayload,
  ToolCallResultPayload,
  ContextCompressingPayload,
  DiffRequestPayload,
  DiffResponsePayload,
  GitStatusSummary,
  UpdateStatusPayload,
  SemanticIndexStatusPayload,
  SemanticIndexInfo,
  WorkspaceFilePayload,
  SaveEmbeddingsPayload,
  SemanticSearchResult,
  JiraProject,
  JiraIssue,
  LinearIssue
} from '../../shared/types'

declare global {
  interface Window {
    api: {
      // Settings
      getSettings:           () => Promise<AppSettings>
      saveSettings:          (settings: AppSettings) => Promise<{ ok: boolean }>
      // Conversations
      listConversations:     () => Promise<Conversation[]>
      saveConversation:      (conv: Conversation) => Promise<{ ok: boolean }>
      deleteConversation:    (id: string) => Promise<{ ok: boolean }>
      // Chat
      sendMessage:           (payload: ChatSendPayload) => Promise<void>
      abortMessage:          (conversationId: string) => Promise<{ ok: boolean }>
      // Stream listeners
      onStreamChunk:         (cb: (payload: StreamChunkPayload) => void) => void
      onStreamDone:          (cb: (payload: StreamDonePayload) => void) => void
      onStreamError:         (cb: (payload: StreamErrorPayload) => void) => void
      // Tool call listeners
      onToolCallStart:       (cb: (payload: ToolCallStartPayload) => void) => void
      onToolCallResult:      (cb: (payload: ToolCallResultPayload) => void) => void
      onContextCompressing:  (cb: (payload: ContextCompressingPayload) => void) => void
      removeStreamListeners: () => void
      // Window / UI
      setTitleBarTheme:      (theme: 'dark' | 'light') => Promise<{ ok: boolean }>
      exportChat:            (payload: ExportChatPayload) => Promise<{ ok: boolean }>
      pickFolder:            () => Promise<{ path: string | null }>
      // Diff viewer
      onDiffRequest:         (cb: (payload: DiffRequestPayload) => void) => void
      respondDiff:           (payload: DiffResponsePayload) => Promise<{ ok: boolean }>
      // Git
      getGitStatus:          (workspacePath: string) => Promise<GitStatusSummary>
      // Terminal / PTY
      createTerminal:        (workspacePath: string, cols: number, rows: number) => Promise<{ sessionId: string; error?: string }>
      writeTerminal:         (sessionId: string, data: string) => Promise<{ ok: boolean }>
      resizeTerminal:        (sessionId: string, cols: number, rows: number) => Promise<{ ok: boolean }>
      killTerminal:          (sessionId: string) => Promise<{ ok: boolean }>
      onTerminalData:        (cb: (payload: { sessionId: string; data: string }) => void) => void
      onTerminalExit:        (cb: (payload: { sessionId: string; exitCode: number }) => void) => void
      removeTerminalListeners: () => void
      // Auto-updater
      onUpdateStatus:        (cb: (payload: UpdateStatusPayload) => void) => void
      removeUpdateListeners: () => void
      checkForUpdates:       () => Promise<{ ok: boolean }>
      downloadUpdate:        () => Promise<{ ok: boolean }>
      installUpdate:         () => Promise<{ ok: boolean }>
      // Semantic / BM25 / embedding index
      buildSemanticIndex:    (workspacePath: string) => Promise<{ ok: boolean; error?: string }>
      getSemanticIndexInfo:  (workspacePath: string) => Promise<SemanticIndexInfo>
      onSemanticIndexStatus: (cb: (payload: SemanticIndexStatusPayload) => void) => void
      removeSemanticListeners: () => void
      getWorkspaceFiles:     (workspacePath: string) => Promise<WorkspaceFilePayload[]>
      saveEmbeddingIndex:    (payload: SaveEmbeddingsPayload) => Promise<{ ok: boolean }>
      vectorSearch:          (workspacePath: string, vector: number[], topK: number) => Promise<SemanticSearchResult[]>
      // Workspace file access — for @-mention
      listWorkspaceFiles:    (workspacePath: string) => Promise<string[]>
      readWorkspaceFile:     (workspacePath: string, relativePath: string) => Promise<{ content: string; error?: string }>
      // Project memory
      readMemory:            (workspacePath: string) => Promise<{ content: string }>
      saveMemory:            (workspacePath: string, content: string) => Promise<{ ok: boolean; error?: string }>
      // Jira integration
      jiraListProjects:      (url: string, email: string, token: string) => Promise<{ ok: boolean; projects?: JiraProject[]; error?: string }>
      jiraListIssues:        (url: string, email: string, token: string, projectKey: string) => Promise<{ ok: boolean; issues?: JiraIssue[]; error?: string }>
      jiraCreateIssue:       (url: string, email: string, token: string, payload: { projectKey: string; summary: string; description: string; issueType: string }) => Promise<{ ok: boolean; key?: string; error?: string }>
      // Linear integration
      linearListIssues:      (token: string) => Promise<{ ok: boolean; issues?: LinearIssue[]; error?: string }>
      linearCreateIssue:     (token: string, payload: { teamId: string; title: string; description: string; priority: number }) => Promise<{ ok: boolean; identifier?: string; error?: string }>
    }
  }
}
