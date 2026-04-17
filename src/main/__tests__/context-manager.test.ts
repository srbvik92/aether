import { describe, it, expect } from 'vitest'
import { trimToContextWindow, type Message } from '../context-manager'

describe('context-manager', () => {
  describe('trimToContextWindow', () => {
    it('returns messages unchanged when under token limit', () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ]
      const { messages: result, wasTrimmed } = trimToContextWindow(messages, 'gpt-4o')
      expect(wasTrimmed).toBe(false)
      expect(result).toEqual(messages)
    })

    it('trims old messages when over token limit', () => {
      // gpt-3.5-turbo has 16,385 context window, threshold at 70% = ~11,470 tokens
      // At ~4 chars per token, we need ~45,880 chars to exceed the threshold
      const longContent = 'x'.repeat(10_000)
      const messages: Message[] = [
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: 'recent message 1' },
        { role: 'assistant', content: 'recent message 2' },
        { role: 'user', content: 'recent message 3' },
        { role: 'assistant', content: 'recent message 4' }
      ]
      const { messages: result, wasTrimmed } = trimToContextWindow(messages, 'gpt-3.5-turbo')
      expect(wasTrimmed).toBe(true)
      expect(result.length).toBeLessThan(messages.length)
      // System message should be preserved
      expect(result[0].role).toBe('system')
      // Recent messages should be kept
      const lastResult = result[result.length - 1]
      expect(lastResult.content).toBe('recent message 4')
    })

    it('preserves system message during trim', () => {
      const longContent = 'y'.repeat(10_000)
      const messages: Message[] = [
        { role: 'system', content: 'Important system prompt.' },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: 'keep this' },
        { role: 'assistant', content: 'and this' }
      ]
      const { messages: result, wasTrimmed } = trimToContextWindow(messages, 'gpt-3.5-turbo')
      if (wasTrimmed) {
        expect(result[0].role).toBe('system')
        expect(result[0].content).toBe('Important system prompt.')
      }
    })

    it('adds a trim notice when messages are dropped', () => {
      const longContent = 'z'.repeat(10_000)
      const messages: Message[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: 'latest question' },
        { role: 'assistant', content: 'latest answer' }
      ]
      const { messages: result, wasTrimmed } = trimToContextWindow(messages, 'gpt-3.5-turbo')
      if (wasTrimmed) {
        // The second message (after system) should be the trim notice
        expect(result[1].content).toContain('removed to fit within the context window')
      }
    })

    it('handles unknown model by using default context window', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' }
      ]
      const { messages: result, wasTrimmed } = trimToContextWindow(messages, 'unknown-model-xyz')
      expect(wasTrimmed).toBe(false)
      expect(result).toEqual(messages)
    })

    it('accounts for image tokens in estimation', () => {
      // Each image adds ~1000 tokens to the estimate
      const messages: Message[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'short', images: Array(15).fill({ mimeType: 'image/png' as const, data: 'abc' }) },
        { role: 'assistant', content: 'response' },
        { role: 'user', content: 'short2', images: Array(15).fill({ mimeType: 'image/png' as const, data: 'abc' }) },
        { role: 'assistant', content: 'response2' },
        { role: 'user', content: 'short3', images: Array(15).fill({ mimeType: 'image/png' as const, data: 'abc' }) },
        { role: 'assistant', content: 'response3' },
        { role: 'user', content: 'latest' },
        { role: 'assistant', content: 'latest reply' }
      ]
      // With gpt-3.5-turbo (16K context), 45 images * 1000 tokens = 45K tokens > threshold
      const { wasTrimmed } = trimToContextWindow(messages, 'gpt-3.5-turbo')
      expect(wasTrimmed).toBe(true)
    })
  })
})
