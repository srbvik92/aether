# Production Readiness Test Plan

Legend: ✅ Verified working · ❌ Known broken · ⚠️ Partial / needs more testing · ⬜ Not yet tested

---

## 1. Provider / Chat Core

| Test | How | Status |
|------|-----|--------|
| Anthropic chat streams correctly | Send a message, verify chunks arrive and stop cleanly | ✅ |
| OpenAI API key chat works | Use gpt-4.1, send a message | ✅ |
| OpenAI OAuth chat works (GPT-5.5) | Sign in with ChatGPT, select GPT-5.5, send a message | ✅ |
| New chat first message works | Click New Chat, send first message — streams correctly, no blank bubble | ✅ |
| Gemini chat works | Set provider + API key, send a message | ⬜ |
| NVIDIA chat works | Set API key, pick any llama model, send | ⬜ |
| OpenRouter chat works | Set API key, pick any model | ⬜ |
| Custom provider works | Point to a local Ollama endpoint, chat | ⬜ |
| Abort mid-stream | Click stop while response is streaming — UI must unblock | ✅ |
| 401 / expired key | Set a bad API key, send — UI must show error and stay usable, not freeze | ✅ |
| Context compression | Have a very long chat (100+ messages) — compression summary should fire without crashing | ⬜ |

---

## 2. Tool Use / Agent Loop

| Test | How | Status |
|------|-----|--------|
| read_file works | Ask "read my package.json" with workspace set | ✅ |
| str_replace / write_file work | Ask AI to add a comment to a file — verify diff approval fires | ✅ |
| run_command works | Ask AI to run `npm test` | ✅ |
| web_search works | Ask "what is today's date?" — AI should search | ✅ |
| fetch_url works | Paste a URL, ask AI to summarise it | ✅ |
| Diff approval — approve | AI proposes edit → click Approve → file is written | ✅ |
| Diff approval — reject | AI proposes edit → click Reject → file unchanged | ✅ |
| Command approval — approve/reject | AI runs a command → approve/reject modal fires | ✅ |
| Max iterations guard | Set maxIterations=3, give a multi-step task — must stop at 3, not loop forever | ✅ |

---

## 3. Conversation Management

| Test | How | Status |
|------|-----|--------|
| New conversation created | Click New Chat, send a message — conversation appears in sidebar | ✅ |
| Auto-title fires | After first message, sidebar title changes from "New Chat" | ✅ |
| Conversation persists across restart | Restart the app — previous chats still visible | ✅ |
| Delete conversation | Delete a chat (confirm prompt) — it disappears and doesn't reappear on restart | ✅ |
| Fork / branch conversation | Right-click a message → branch — creates new child conversation | ✅ |
| Import / export conversation | Export as JSON, delete, re-import — messages intact | ✅ |

---

## 4. Settings & Auth

| Test | How | Status |
|------|-----|--------|
| Settings save and persist | Change model, close settings, reopen — model still set | ✅ |
| System prompt persists | Change system prompt, restart app — still shows new prompt | ✅ |
| System prompt auto-restores | Clear system prompt, save, restart — must restore the default | ✅ |
| OpenAI OAuth login flow | Click "Sign in with OpenAI" — browser opens, redirect back, token stored | ✅ |
| OpenAI OAuth token refresh | Wait for token to near expiry — refresh happens silently | ⬜ |
| OpenAI OAuth logout | Click logout — token cleared, model list resets | ✅ |
| Live model list fetch | With valid API key, open Settings → OpenAI models load within 5s | ⬜ |
| GPT-5 models visible | With OAuth token, GPT-5 group appears in dropdown | ✅ |
| API key validation UI | Enter partial key — red error hint appears | ✅ |

---

## 5. Context Window / Token Management

| Test | How | Status |
|------|-----|--------|
| Compression triggers correctly | Long conversation with 70%+ context used — compression summary fires, spinner shown | ⬜ |
| Fallback trim works | Make compression fail (set bad summary model key) — trim notice appears, chat continues | ⬜ |
| GPT-4.1 uses 1M window | 1,047,576 context window used, not 128K default | ⬜ |
| GPT-5 uses 200K window | Confirm context-manager picks up gpt-5 entry | ⬜ |

---

## 6. UI / UX

| Test | How | Status |
|------|-----|--------|
| Dark / light / system theme | Toggle all three — no flash, no unstyled content | ⬜ |
| Code blocks render with syntax highlight | Ask AI to write a TypeScript function — highlighted correctly | ✅ |
| Markdown renders | Bold, italic, tables, lists all render in AI messages | ✅ |
| Image attachment | Attach a PNG, send — message shows thumbnail, AI responds about image | ✅ |
| Streaming feels smooth | Long response streams without jank or layout shift | ✅ |
| Stop button clears spinner | After abort, no spinning indicators left anywhere | ✅ |
| UI never freezes after error | Trigger any API error — spinner goes away, input re-enables | ✅ |
| Scroll-to-bottom button | Scroll up mid-chat — down arrow appears; click it — jumps to latest message | ✅ |
| URL fetch card | Paste a URL — collapsible fetch card appears in the user bubble | ✅ |

---

## 7. Performance & Stability

| Test | How | Status |
|------|-----|--------|
| Cold start time | App opens in under 4 seconds | ⬜ |
| Memory after 50 messages | Open Task Manager — renderer process under 500 MB | ⬜ |
| No memory leak over long session | Chat for 30+ minutes — memory stays flat | ⬜ |
| Rebuild is clean | `npx tsc --noEmit` → zero errors, `npm run build` → succeeds | ✅ |

---

## 8. Edge Cases

| Test | How | Status |
|------|-----|--------|
| Empty message send blocked | Hit send with no text — nothing happens | ✅ |
| Very long single message | Paste 50KB of code — no crash, AI responds | ⬜ |
| Rapid-fire send | Click send 5 times fast — only one request goes out | ✅ |
| Offline mode | Disconnect network mid-stream — graceful error, not frozen UI | ⬜ |
| Port 1455 already in use | OAuth login when another process holds 1455 — clear error shown | ⬜ |
| Workspace path doesn't exist | Set workspace to a deleted folder — tools fail gracefully, no crash | ⬜ |
