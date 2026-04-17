# ChatUI — Feature Test Guide

A manual QA checklist covering every feature built so far.
Check each box as you verify it works. Rebuild the app (`npm run build`) before testing.

---

## Setup

- [ ] App launches without errors
- [ ] Open **Settings** → enter your Anthropic API key → Save
- [ ] Set a **Workspace** folder (a real project directory)
- [ ] Confirm the model shown in the header (e.g. `claude-sonnet-4-6`)

---

## 1. Core Chat

- [ ] Type a message and press **Enter** → AI responds
- [ ] **Shift+Enter** inserts a newline instead of sending
- [ ] AI response streams in token by token (not all at once)
- [ ] Token count pill in header updates after the response
- [ ] Cost (e.g. `$0.001`) appears next to token count if pricing is known for the model

---

## 2. Stop / Abort

- [ ] While AI is responding, a **"⬛ Stop generating"** pill appears above the input
- [ ] Clicking it stops the stream immediately
- [ ] Stopped message shows a small `□ stopped` badge below the bubble
- [ ] The small `■` stop icon inside the input box also works
- [ ] After stopping, you can send a new message normally

---

## 3. Connection Error Handling

- [ ] Temporarily break your API key in Settings → Send a message
- [ ] Error bubble appears: **"Error: ..."**
- [ ] No blinking blank AI bubbles are left behind
- [ ] Restore the API key → Send again → works normally

---

## 4. Conversation Management

### New / Switch
- [ ] Click **New Chat** in the sidebar → blank slate
- [ ] Previous conversation is saved and appears in the sidebar list
- [ ] Click an old conversation → messages reload correctly
- [ ] **Ctrl+N** opens a new chat

### Rename / Delete
- [ ] Conversation title is auto-derived from the first message
- [ ] Hover a conversation in sidebar → delete button (×) appears
- [ ] Deleting removes it from the list

### Search (Ctrl+Shift+F)
- [ ] Press **Ctrl+Shift+F** → search modal opens
- [ ] Type a keyword that appears in an old conversation → results show with highlighted matches
- [ ] Click a result → jumps to that conversation
- [ ] **Esc** closes the modal
- [ ] Arrow keys ↑↓ navigate results, **Enter** selects

---

## 5. Model Picker

- [ ] Click the model name in the top-left header → dropdown opens
- [ ] Select a different model → model name updates
- [ ] Send a message → response uses the new model
- [ ] Switch to an old conversation → model reverts to the one it was started with (per-conversation lock)
- [ ] Switch back to a new chat → global model setting applies

---

## 6. Conversation Branching

- [ ] Hover over any message bubble → action icons appear
- [ ] Click the **branch icon** (⎇) on a user or AI message
- [ ] A new conversation opens in the sidebar prefixed with `⎇`
- [ ] The branched conversation contains messages up to and including the branched point
- [ ] Replies in the branch don't affect the original conversation

---

## 7. Message Editing

- [ ] Hover over a **user** message → click the **edit (pencil)** icon
- [ ] Edit the text → click **Resend ↵** or press Enter
- [ ] Messages after the edited one are removed; AI re-responds from that point
- [ ] Cancel edit with **Esc** → original message unchanged

---

## 8. Markdown Rendering

### In AI responses
- [ ] Ask: `show me a markdown example with headers, bold, a list, and a code block`
- [ ] Headers render large, bold text renders bold, lists render as bullet points
- [ ] Code block has syntax highlighting + a **Copy** button

### In user bubbles
- [ ] Type: `**bold** _italic_ \`code\` and a [link](https://example.com)`
- [ ] User bubble renders bold, italic, inline code, and a clickable link

### Shell code blocks
- [ ] Ask: `show me a bash command to list files`
- [ ] Code block has a **Run** button (for bash/sh/zsh blocks)

---

## 9. File Attachments

- [ ] Click the **paperclip** icon → pick a source file
- [ ] File chip appears above the input
- [ ] Send → AI can see and discuss the file content
- [ ] Drag and drop a file onto the chat area → same result
- [ ] Attach 8 files → 9th attachment is rejected with an error message
- [ ] **Clear all** button removes all chips at once

---

## 10. Image Attachments (Vision)

- [ ] Paste an image from clipboard into the chat input
- [ ] Or drag and drop a `.png` / `.jpg` onto the chat
- [ ] Image thumbnail appears as a chip
- [ ] Send → AI describes the image correctly
- [ ] Ask: `what do you see in this image?` → relevant answer

---

## 11. @ File Mentions

> Requires a Workspace to be set.

- [ ] Type `@` in the input → autocomplete dropdown appears
- [ ] Type a partial filename → list filters
- [ ] Select a file → it appears as a mention chip
- [ ] Send → AI can reference the file content in its answer

---

## 12. Tool Use (Agent Loop)

> Requires a Workspace to be set.

- [ ] Ask: `list the files in my workspace`
- [ ] A tool card appears showing **list_files** with a spinner while running
- [ ] After completion the card shows ✓ Done and the output (collapsible)
- [ ] Ask: `read the contents of [a file you know exists]`
- [ ] **read_file** tool card appears, then AI discusses the file

### Terminal command (streaming output)
- [ ] Ask: `run \`echo hello world\` in the terminal`
- [ ] Tool card shows live streaming output with a blinking cursor while running
- [ ] Final output is shown in the collapsed section after completion

---

## 13. Project Memory

> Requires a Workspace to be set.

### Manual editing
- [ ] Click the **🧠** button in the top-right header
- [ ] Memory panel opens — textarea is focused
- [ ] Type a note: `- We use TypeScript strict mode`
- [ ] After ~1 second: status shows **Saving… → Saved ✓**
- [ ] Press **Esc** → panel closes
- [ ] Reopen panel → note is still there

### AI reads memory
- [ ] Start a **new conversation**
- [ ] Ask: `what coding standards should I follow?`
- [ ] AI mentions TypeScript strict mode (from the memory you saved)

### AI writes memory
- [ ] Say: `remember that our database is PostgreSQL`
- [ ] A **💾** tool card appears (remember tool)
- [ ] Open 🧠 panel → new entry appended with today's date

### Persistence
- [ ] Close and reopen the app
- [ ] Open 🧠 → notes are still there
- [ ] Check `<workspace>/.ai-memory/notes.md` exists in your project folder

### Clear
- [ ] Click **Clear all** in the panel → confirm → content cleared
- [ ] File on disk is now empty

---

## 14. Context Window Warning

- [ ] Have a long conversation (or paste a large document multiple times)
- [ ] At ~75% context usage: a **yellow** banner appears above the input
- [ ] At ~90%: banner turns **orange**
- [ ] At ~95%: banner turns **red** with "Start a new chat or branch" message
- [ ] Clicking **New chat** in the banner opens a fresh conversation

---

## 15. Context Compression

- [ ] Have a very long conversation (many back-and-forth messages with large content)
- [ ] When context hits ~70% full, a purple **"Compressing context…"** spinner appears
- [ ] It disappears when the AI starts responding
- [ ] AI response is coherent and references earlier parts of the conversation
- [ ] If compression fails silently (e.g. API error), the request still goes through (hard-trim fallback)

---

## 16. Prompt Caching

- [ ] In Settings, set a custom System Prompt (a few paragraphs long)
- [ ] Send 2+ messages in the same conversation
- [ ] In your Anthropic dashboard, verify cache read tokens appear (shows as `cache_read_input_tokens`)
- [ ] Cost should be noticeably lower on the 2nd+ message vs. the 1st

---

## 17. Quick Templates

- [ ] Click the **template icon** (document icon) in the top-right header
- [ ] A dropdown of preset system prompts appears
- [ ] Select one → system prompt updates
- [ ] Send a message → AI behaves according to the selected persona/template

---

## 18. Export

- [ ] Have a conversation with several messages
- [ ] Click the **export icon** in the top-right header
- [ ] Options: **Markdown**, **JSON**, maybe **plain text**
- [ ] Download the file → open it and verify all messages are present

---

## 19. Git Status Bar

> Requires a Workspace that is a git repository.

- [ ] Status bar at the bottom of the sidebar shows branch name (e.g. `main`)
- [ ] Shows staged / unstaged / untracked counts
- [ ] Make a file change in your workspace → counts update on next send

---

## 20. Keyboard Shortcuts

| Shortcut | Expected action |
|---|---|
| `Ctrl+N` | New chat |
| `Ctrl+Shift+F` | Open conversation search |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Esc` | Close search / memory panel / edit mode |

---

## 21. Diff Approval (Write File Tool)

- [ ] Ask: `create a new file called test-output.txt with the content "hello from AI"`
- [ ] A **diff panel** appears showing the proposed change
- [ ] Click **Approve** → file is created in workspace
- [ ] Click **Reject** on a subsequent write → file is not changed

---

## 22. Settings Persistence

- [ ] Set API key, model, system prompt, workspace
- [ ] Close the app completely
- [ ] Reopen → all settings are restored
- [ ] Chat history is also fully restored

---

## 23. Dark / Light Mode

- [ ] Toggle your OS dark/light mode
- [ ] App theme follows OS setting automatically

---

## Known Limitations (don't file as bugs)

- Conversations are capped at **100** (oldest are dropped first)
- Context compression only triggers when hitting 70%+ of the model's context window — normal conversations won't see it
- Gemini context compression uses the Google AI Studio OpenAI-compat endpoint (requires AI Studio key, not Vertex)
- The `remember` tool only appends; the 🧠 panel is the way to edit/delete notes

---

*Last updated: 2026-04-11*
