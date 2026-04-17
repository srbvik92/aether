import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import { AppSettings, MessageRole } from '../shared/types'

// ─── Unified streaming API client ─────────────────────────────────────────
//
//  Supports:
//    - Anthropic  (claude-*)           → Anthropic SDK
//    - OpenAI     (gpt-*)              → OpenAI SDK
//    - Gemini     (gemini-*) via Vertex → @google-cloud/vertexai
//    - Custom     (any OpenAI-compat)  → OpenAI SDK with custom baseURL

export class AIClient {
  constructor(private settings: AppSettings) {}

  async *streamMessage(
    messages: { role: MessageRole; content: string }[]
  ): AsyncGenerator<string> {
    switch (this.settings.provider) {
      case 'anthropic':
        yield* this.streamAnthropic(messages)
        break
      case 'gemini':
        yield* this.streamGemini(messages)
        break
      default:
        // openai + custom both use the OpenAI-compatible SDK
        yield* this.streamOpenAICompat(messages)
    }
  }

  // ── Anthropic ────────────────────────────────────────────────────────────

  private async *streamAnthropic(
    messages: { role: MessageRole; content: string }[]
  ): AsyncGenerator<string> {
    const client = new Anthropic({
      apiKey: this.settings.apiKey,
      baseURL:
        this.settings.baseUrl !== 'https://api.anthropic.com'
          ? this.settings.baseUrl
          : undefined
    })

    const systemMessage = messages.find((m) => m.role === 'system')
    const conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const stream = client.messages.stream({
      model: this.settings.model,
      max_tokens: this.settings.maxTokens,
      system: systemMessage?.content ?? this.settings.systemPrompt,
      messages: conversationMessages
    })

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text
      }
    }
  }

  // ── Gemini via Google Gen AI SDK (@google/genai) ─────────────────────────
  // Supports both Vertex AI (vertexProjectId set) and AI Studio (apiKey only)

  private async *streamGemini(
    messages: { role: MessageRole; content: string }[]
  ): AsyncGenerator<string> {
    const { vertexProjectId, vertexLocation, vertexServiceAccountKey, apiKey, model, maxTokens, systemPrompt } =
      this.settings

    // Build client
    let ai: GoogleGenAI
    if (vertexProjectId) {
      if (vertexServiceAccountKey.trim()) {
        try { JSON.parse(vertexServiceAccountKey) } catch {
          throw new Error('Invalid Service Account Key JSON — check the format')
        }
      }
      ai = new GoogleGenAI({
        vertexai: true,
        project:  vertexProjectId,
        location: vertexLocation || 'global'
      })
    } else if (apiKey) {
      ai = new GoogleGenAI({ apiKey })
    } else {
      throw new Error('No API key or Vertex Project ID configured for Gemini')
    }

    const systemMessage = messages.find((m) => m.role === 'system')
    const systemText    = systemMessage?.content ?? systemPrompt

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        maxOutputTokens: maxTokens,
        ...(systemText ? { systemInstruction: systemText } : {})
      }
    })

    for await (const chunk of stream) {
      const text = chunk.text
      if (text) yield text
    }
  }

  // ── OpenAI-compatible ─────────────────────────────────────────────────────

  private async *streamOpenAICompat(
    messages: { role: MessageRole; content: string }[]
  ): AsyncGenerator<string> {
    const client = new OpenAI({
      apiKey: this.settings.apiKey,
      baseURL: this.settings.baseUrl
    })

    const allMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    }))

    if (!allMessages.find((m) => m.role === 'system')) {
      allMessages.unshift({ role: 'system', content: this.settings.systemPrompt })
    }

    const stream = await client.chat.completions.create({
      model: this.settings.model,
      max_tokens: this.settings.maxTokens,
      messages: allMessages,
      stream: true
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) yield delta
    }
  }

  // ── Test connection ───────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const testMessages = [{ role: 'user' as MessageRole, content: 'Say "OK" only.' }]
      let received = false
      for await (const chunk of this.streamMessage(testMessages)) {
        if (chunk) { received = true; break }
      }
      return { ok: received }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
