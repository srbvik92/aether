# Manual Testing Checklist

Everything Playwright **cannot** test (native OS features, real API calls, file system, IPC-heavy flows).  
Check off each item as you verify it.

---

## 1. API & Model Connectivity

- [ ] **Valid API key** — Enter a real Anthropic/OpenAI/Gemini key in Settings, send a message, get a response
- [ ] **Invalid API key** — Enter a wrong key, send a message → red error card with "Authentication failed" message appears
- [ ] **Model not available** — Select a model that doesn't exist for the provider → error card shows "Open Settings to change model" button → clicking it opens Settings
- [ ] **Quota / billing error** — Trigger quota exceeded (or simulate) → error card shows billing message
- [ ] **NVIDIA NIM / Custom provider** — Set base URL + model for a custom OpenAI-compatible endpoint, send a message, get a response
- [ ] **Streaming** — Response streams in token-by-token (not all at once)
- [ ] **Stop generating** — Click Stop mid-stream → generation halts, message is preserved up to that point

---

## 2. Chat Core

- [ ] **Send message with Enter** — Textarea sends on Enter, newline on Shift+Enter
- [ ] **Multi-turn conversation** — Send 3+ back-and-forth messages, context is maintained
- [ ] **Edit user message** — Hover a user bubble → click edit → change text → resend → AI regenerates from that point
- [ ] **Regenerate AI response** — Hover AI bubble → click regenerate → new response replaces old one
- [ ] **Copy message** — Copy button copies full message text to clipboard
- [ ] **Rate message** — Thumbs up / thumbs down buttons record rating without error
- [ ] **Branch conversation** — Branch button creates a fork; switching branches shows different history
- [ ] **Auto-title** — After first AI response, conversation gets an auto-generated title in the sidebar
- [ ] **Context compression** — After many messages (10+), "Compressing context…" indicator appears only when actually compressing, not on every message

---

## 3. File Attachments

- [ ] **Attach image** — Click paperclip → pick an image → it appears as thumbnail → AI describes it
- [ ] **Paste image** — Ctrl+V a screenshot into the textarea → attaches and sends
- [ ] **Drag & drop image** — Drag an image file onto the chat → attaches
- [ ] **File too large** — Try attaching a file > 200 KB → shown an error/rejected
- [ ] **Too many files** — Attach more than 8 files at once → capped at 8

---

## 4. @ File Mentions

- [ ] **Trigger dropdown** — Type `@` in the textarea → file mention dropdown appears
- [ ] **Filter by name** — Type `@src` → list narrows to matching files
- [ ] **Select file** — Click/Enter on a file → inserted as `@filename` token in message
- [ ] **File content injected** — Send a message with `@filename` → AI receives the file contents

---

## 5. Workspace & File Editor

- [ ] **Set workspace path** — In Settings, pick a folder → path is saved and shown
- [ ] **Open file from message** — AI references a file path → clicking it opens the FileEditorModal
- [ ] **Edit & save file** — In FileEditorModal, change content and save → file on disk is updated
- [ ] **Diff viewer** — AI proposes a code change → diff is shown with green/red highlights
- [ ] **Approve / reject edit** — With `requireEditApproval` on, AI write triggers approval modal → Approve applies the change, Reject discards

---

## 6. Terminal Panel

- [ ] **Open terminal** — Click Terminal button in sidebar → xterm panel appears
- [ ] **Run a command** — Type `echo hello` → output shows in terminal
- [ ] **Close terminal** — Click Terminal button again → panel hides
- [ ] **Terminal persists across messages** — Send a chat message while terminal is open → terminal stays open

---

## 7. Settings Panel

- [ ] **Save API key** — Enter key → close Settings → reopen → key is persisted
- [ ] **Switch provider** — Change from Anthropic to OpenAI → model list updates to OpenAI models
- [ ] **Switch model** — Change model dropdown → new model is used for next message
- [ ] **Default system prompt** — Select Default → uses built-in prompt (not editable)
- [ ] **Custom system prompt** — Select Custom → enter your own prompt → AI follows it in next conversation
- [ ] **Workspace path picker** — Click folder icon → OS file picker opens → selecting a folder saves it
- [ ] **Require edit approval toggle** — Toggle off → AI writes files without showing diff approval modal
- [ ] **Reasoning depth** — Change reasoning slider → AI uses different reasoning effort

---

## 8. Conversation Management (Sidebar)

- [ ] **New chat** — Ctrl+N or New Chat button → blank chat opens
- [ ] **Switch conversations** — Click older conversation → history loads correctly
- [ ] **Rename conversation** — Right-click or rename button → type new name → saved
- [ ] **Delete conversation** — Delete button → confirmation → removed from list
- [ ] **Search conversations** — Click search or Ctrl+K → type keyword → matching conversations shown
- [ ] **Pin / unpin** — Pin a conversation → appears at top of list

---

## 9. Memory & Context Features

- [ ] **Global memory** — Open Global Memory panel → add a memory entry → it persists after restart and is injected into new chats
- [ ] **Pinned files** — Pin a file → it's always included in context for that conversation
- [ ] **Project summary** — Generate project summary → shown in context panel
- [ ] **Context token bar** — Shows current token usage; updates as conversation grows

---

## 10. MCP Servers

- [ ] **Add MCP server** — Open MCP panel → add a server config → server connects
- [ ] **Tool from MCP** — Send a message that triggers an MCP tool → tool executes, result shown in chat
- [ ] **Remove MCP server** — Delete a server → no longer available in next message

---

## 11. Git Integration

- [ ] **Git status bar** — Open a repo as workspace → status bar shows branch name + dirty file count
- [ ] **Commit from AI** — AI runs a git commit via tool → GitStatusBar updates
- [ ] **GitHub panel** — Open GitHub panel → shows PRs/issues for connected repo (requires GitHub token in settings)

---

## 12. Voice Input

- [ ] **Microphone button** — Click mic button → browser/OS asks for mic permission
- [ ] **Record & transcribe** — Speak → click stop → text appears in textarea
- [ ] **Cancel recording** — Press Escape while recording → textarea unchanged

---

## 13. Cost Dashboard

- [ ] **Open costs** — Click Costs button in sidebar → dashboard opens
- [ ] **Per-conversation cost** — Shows token counts and estimated cost for each conversation
- [ ] **Total cost** — Aggregate total is calculated correctly

---

## 14. Keyboard Shortcuts

- [ ] **Ctrl+N** — New chat
- [ ] **Ctrl+K** — Open conversation search
- [ ] **Ctrl+/** or **Ctrl+?** — Open keyboard shortcuts modal
- [ ] **Escape** — Close modals / go back to chat from Settings
- [ ] **Ctrl+Enter** — Send message (alternative to Enter)
- [ ] **Arrow keys in dropdown** — Navigate `@` file mention dropdown with keyboard

---

## 15. Theme & Window

- [ ] **Dark mode** — Entire app switches to dark theme
- [ ] **Light mode** — Entire app switches to light theme
- [ ] **System (follow OS)** — Theme matches OS dark/light setting; changes when OS theme changes
- [ ] **Window resize** — App layout adapts at narrow widths without overflow/clipping
- [ ] **Sidebar collapse** — Sidebar can be hidden to give more chat space

---

## 16. Auto-Update

- [ ] **Update check on launch** — App silently checks for updates (no 404 error toasts for private repo)
- [ ] **Update banner** — When a new release is available, a banner appears offering to update
- [ ] **Install update** — Clicking update downloads and restarts to new version

---

## 17. Onboarding

- [ ] **Fresh install** — Delete `userData` folder, relaunch → onboarding wizard appears
- [ ] **Complete flow** — Go through all onboarding steps with a real provider → lands on chat screen with API key saved
- [ ] **Skip onboarding** — Click "Skip setup" → lands on chat screen, settings still accessible
- [ ] **Back navigation** — Step 2+ shows Back button → goes to previous step

---

## 18. Notifications & Background

- [ ] **App in background** — Minimize app while a long response is streaming → response completes normally
- [ ] **OS notification** — (Agent mode) Minimize during agent execution → OS notification fires when done

---

## 19. Error & Edge Cases

- [ ] **No internet** — Disable network → send message → user-friendly error shown (not a raw JSON blob)
- [ ] **Very long message** — Paste 10,000+ characters → sends without hanging
- [ ] **Rapid send** — Click Send repeatedly fast → no duplicate messages
- [ ] **App restart with open conversation** — Close and reopen app → last active conversation reloads

---

## Automated (Playwright) — Already Covered ✅

| Area | Tests |
|------|-------|
| Onboarding wizard (skip, steps, back, progress dots) | `e2e/onboarding.test.ts` |
| Chat textarea visible after skip | `e2e/navigation.test.ts` |
| New chat button | `e2e/navigation.test.ts` |
| Settings open / back button / system prompt toggle / custom textarea | `e2e/settings.test.ts` |
| Theme toggle (dark/light/system buttons visible & clickable) | `e2e/navigation.test.ts` |
| Terminal toggle button visible + opens `.xterm` + toggles off | `e2e/panels.test.ts` |
| Log viewer button + opens modal | `e2e/panels.test.ts` |
| Keyboard shortcuts modal (`Ctrl+?`) | `e2e/panels.test.ts` |
