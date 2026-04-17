# AI Code App — Architecture & Decision Log

> Living document. Updated as features are added.
> Goal: A great BYOK desktop coding assistant that rivals Claude Code / Cursor.

---

## 1. What This Is

A Windows-first (later cross-platform) desktop AI coding assistant built with:
- **Electron** — Chromium + Node.js in one process pair
- **React + TypeScript** — renderer UI
- **Tailwind CSS** — styling with dark/light mode
- **electron-vite** — fast dev server with HMR

**BYOK (Bring Your Own Key)** — The app ships with zero API backend. Users plug in their own API keys. The app calls provider APIs directly from Electron's main process. This is the industry-standard model used by Cursor, Continue, Codeium, etc.

---

## 2. Process Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                            │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ ipc-handlers│  │  api-client  │  │  agent-loop       │  │
│  │             │  │  (AI SDKs)   │  │  (tool use loop)  │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                │                   │              │
│  ┌──────▼──────────────────────────────────▼──────────┐    │
│  │              electron-store (encrypted)              │    │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │  contextBridge / IPC
                         │  (ipcMain.handle / webContents.send)
┌────────────────────────▼────────────────────────────────────┐
│  Renderer Process (Chromium + React)                        │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────┐    │
│  │ Sidebar  │  │ ChatWindow │  │  Settings            │    │
│  │ (search, │  │ (messages, │  │  (providers, keys,   │    │
│  │  rename) │  │  files,    │  │   workspace)         │    │
│  └──────────┘  │  export)   │  └──────────────────────┘    │
│                └────────────┘                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  window.api  (preload/contextBridge — typed surface) │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Why contextBridge?
Electron's security model forbids the renderer from accessing Node.js APIs directly. `contextBridge.exposeInMainWorld` creates a typed, restricted API surface (`window.api`) — the only way the renderer talks to Node.js. This is non-negotiable for production apps.

---

## 3. Provider Architecture

All providers are unified behind a single streaming interface:

```
AIClient.streamMessage(messages) → AsyncGenerator<string>
```

| Provider | SDK | Auth |
|---|---|---|
| Anthropic | `@anthropic-ai/sdk` | API key |
| OpenAI | `openai` | API key |
| Gemini | `@google-cloud/vertexai` | Service Account JSON or ADC |
| Custom | `openai` (compat) | API key (optional) |

**Key decision:** Gemini uses Vertex AI (not Google AI Studio) because Vertex is the enterprise-grade path with service account auth, no rate limits, and support for private model deployments.

---

## 4. Storage

**electron-store v8.2.0** (NOT v10 — v10 is ESM-only, incompatible with Electron's CommonJS main process).

Two stores:
- `settings.json` — encrypted with AES (API keys safe at rest)
- `conversations.json` — unencrypted (not sensitive)

Encryption key is hardcoded app-side (industry norm for desktop apps — keys are on the user's own machine).

---

## 5. Streaming Architecture

```
Main process                     Renderer
────────────────                 ────────────────
ipcMain.handle(CHAT_SEND)
  → for await chunk of AIClient
    → webContents.send(STREAM_CHUNK, { chunk })  →  useChat accumulates
  → webContents.send(STREAM_DONE)               →  useChat finalizes
  → webContents.send(STREAM_ERROR) on error     →  useChat shows error
```

Abort: `AbortController` map keyed by conversationId. Renderer calls `CHAT_ABORT` → main aborts the generator.

---

## 6. Tool Use / Agent Loop  ← Added 2025-04

This is the feature that turns a chat UI into a coding agent.

### What it enables
The AI can now autonomously:
- Read files from the user's workspace
- Write/create files
- List directory contents
- Search for text across files (grep)
- Run shell commands

### Architecture

```
Agent Loop (main process only — has Node.js access)

User sends message
       │
       ▼
┌──────────────────────────────────────────────┐
│  Iteration N                                  │
│  1. Call AI with tool definitions (schema)   │
│  2. Stream text chunks → STREAM_CHUNK         │
│  3. AI returns tool_use blocks               │
│     → emit TOOL_CALL_START to renderer       │
│     → execute tool (fs / child_process)      │
│     → emit TOOL_CALL_RESULT to renderer      │
│  4. If stop_reason = 'end_turn': DONE        │
│  5. Else: add tool results to messages       │
│     → goto Iteration N+1                    │
└──────────────────────────────────────────────┘
       │
       ▼
  STREAM_DONE
```

### Safety
- **Path sandboxing**: All file paths are resolved against the workspace root and rejected if they escape it (path traversal protection)
- **Command timeout**: Shell commands have a 30-second timeout
- **Output truncation**: Tool results > 50KB are truncated with a notice
- **Workspace required**: Tools return a friendly error if no workspace is configured

### Provider support
| Provider | Tool Use | Notes |
|---|---|---|
| Anthropic | ✅ | Native `tool_use` blocks — best quality |
| OpenAI | ✅ | Function calling via `tool_calls` |
| Custom | ✅ | OpenAI-compatible endpoints (Ollama, LM Studio) |
| Gemini | ✅ | Vertex AI function calling — streams first turn, non-stream for tool continuations |

### Why Anthropic first?
Claude has the best tool use quality. It follows instructions reliably, reads complex codebases well, and handles multi-step tool chains with minimal hallucination. The architectural pattern (tool definitions as JSON schema, tool_use blocks, tool_result messages) is nearly identical to OpenAI — adding OpenAI support is a small delta.

### Tools implemented
| Tool | Description |
|---|---|
| `read_file` | Read any text file in the workspace |
| `write_file` | Create or overwrite a file |
| `list_directory` | List directory contents with sizes and types |
| `search_files` | Grep-like text search across files |
| `run_command` | Execute shell commands (PowerShell/bash) |

---

## 7. UI Architecture

### Message rendering
- `react-markdown` + `remark-gfm` for full markdown
- `react-syntax-highlighter` (Prism) for syntax-highlighted code blocks
- Copy button on every code block
- Tool call cards rendered inline in AI messages (collapsible, show input/output)

### Theme system
- Tailwind `darkMode: 'class'` strategy — `dark` class on `<html>`
- Theme stored in both `electron-store` (persistent) and `localStorage` (for pre-render flash prevention)
- Native title bar (Windows overlay buttons) updated via `setTitleBarOverlay()` IPC
- Applied synchronously before React renders in `main.tsx` to prevent flash

### Component tree
```
App
├── Sidebar (conversations, search, rename, theme toggle, settings button)
└── ChatWindow | Settings
    ├── MessageBubble (markdown, tool calls, code blocks)
    └── Input area (file attachments, drag-drop, token counter)
```

---

## 8. Features Implemented

| Feature | Status |
|---|---|
| Multi-provider streaming chat | ✅ |
| BYOK encrypted key storage | ✅ |
| Conversation history + persistence | ✅ |
| Sidebar search + rename | ✅ |
| Dark/light theme (native title bar) | ✅ |
| Markdown + syntax highlighting | ✅ |
| Copy code button | ✅ |
| File attachment (drag-drop + browse) | ✅ |
| Keyboard shortcuts | ✅ |
| Export chat (.md / .txt) | ✅ |
| Token + cost estimator | ✅ |
| Tool use / agent loop (Anthropic) | ✅ |
| Workspace folder picker | ✅ |
| **Diff viewer with approve/reject** | ✅ |
| **Context window management** | ✅ |
| **OpenAI / Custom tool use** | ✅ |
| **Workspace codebase indexing** | ✅ |
| **Git integration** | ✅ |
| **Auto-updater** | ✅ |
| **Semantic search / embeddings** | ✅ |

---

## 9. Roadmap

### Next priorities
- [ ] ~~**Git integration**~~ — done
- [ ] ~~**Gemini tool use**~~ — done
- [ ] ~~**Auto-updater**~~ — done
- [ ] ~~**Semantic search / embeddings**~~ — done
- [ ] **AI summarization** — instead of truncating, have AI summarize old context (better quality than drop)
- [ ] **Semantic search / embeddings** — index codebase with vectors for "find relevant files" queries (local via `@xenova/transformers`)
- [ ] **Multi-window** — open multiple workspaces side by side

### Architectural direction
The long-term goal is to replicate the core Claude Code loop:
1. User gives a task
2. AI explores the codebase autonomously
3. Makes changes (write_file, run tests, iterate)
4. Presents a summary of what changed

This requires:
- **Reliable multi-step tool chains** (already works)
- **Codebase indexing** so the AI knows what files exist without listing every directory
- **Diff/approval UI** so users stay in control of writes
- **Test runner integration** so the AI can verify its own changes

---

## 10. Key Dependencies

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^28 | Desktop runtime |
| `electron-vite` | ^2 | Build tool + HMR |
| `electron-store` | **8.2.0** | Encrypted settings (NOT v10 — ESM-only) |
| `@anthropic-ai/sdk` | ^0.39 | Anthropic streaming + tool use |
| `openai` | ^4.77 | OpenAI + custom endpoints |
| `@google-cloud/vertexai` | ^1.11 | Gemini via Vertex AI |
| `electron-updater` | ^6.8 | Auto-update via GitHub Releases |
| `@xenova/transformers` | ^2.17 | Local WASM embeddings (all-MiniLM-L6-v2) |
| `react-markdown` | latest | Markdown rendering |
| `remark-gfm` | latest | Tables, strikethrough, task lists |
| `react-syntax-highlighter` | latest | Code syntax highlighting |
