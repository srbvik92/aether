import { describe, it, expect, vi } from 'vitest'
import { withRetry } from '../api-retry'

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn, { maxRetries: 3 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on retryable error and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('status code: 429'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on network error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Invalid API key'))
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toThrow('Invalid API key')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('status code: 503'))
    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10 })).rejects.toThrow('503')
    expect(fn).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn()
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('status code: 500'))
      .mockResolvedValue('ok')

    await withRetry(fn, { maxRetries: 2, baseDelay: 10, onRetry })
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Error))
  })

  it('respects retryOn429 = false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('429 rate_limit'))
    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10, retryOn429: false })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
