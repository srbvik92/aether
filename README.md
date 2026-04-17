# Aether

A powerful AI desktop agent built with Electron, React, and TypeScript. Bring your own API key and run it fully locally.

## Features

- **Multi-provider** — Anthropic (Claude), OpenAI (GPT), Google Gemini, NVIDIA NIM, and any OpenAI-compatible endpoint
- **Agent mode** — autonomous multi-step task execution with auto-continue, pause, and stop
- **File edit approval** — diff viewer with accept / reject / accept-all before any file is written
- **Built-in terminal** — PTY terminal panel inside the app
- **Activity panel** — live view of model, tool calls, and changed files
- **Log viewer** — full application log viewer with level filtering and search
- **Context window indicator** — circular fill indicator showing real token usage next to the model picker
- **Conversation search** — full-text search across all conversations
- **Voice mode** — speech-to-text input
- **Themes** — dark, light, system

## Stack

- **Electron** + **electron-vite**
- **React 18** + **TypeScript**
- **Tailwind CSS**
- **node-pty** for terminal

## Getting Started

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build
```

## Configuration

On first launch, go to **Settings** and add your API key for your chosen provider:

| Provider | Key needed |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Gemini / Vertex AI | Service account JSON |
| NVIDIA NIM | `NVIDIA_API_KEY` |
| Custom / Local | Optional (e.g. Ollama needs none) |

Set a **Workspace Path** to enable file read/write and shell command tools.

## License

MIT
