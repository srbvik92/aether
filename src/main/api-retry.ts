/**
 * Retry wrapper for API calls with exponential backoff.
 * Handles 429 (rate limit), 500/502/503 (server errors), and network failures.
 */

import { log } from './logger'

export interface RetryOptions {
  maxRetries?:   number   // default 3
  baseDelay?:    number   // default 1000ms
  maxDelay?:     number   // default 30000ms
  retryOn429?:   boolean  // default true
  retryOnError?: boolean  // default true
  onRetry?:      (attempt: number, delay: number, error: unknown) => void
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529])

function isRetryableError(error: unknown): boolean {
  if (!error) return false
  const msg = String(error)

  // Network errors
  if (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') ||
      msg.includes('ETIMEDOUT') || msg.includes('fetch failed') ||
      msg.includes('network') || msg.includes('socket hang up')) {
    return true
  }

  // API status code errors
  const statusMatch = msg.match(/status\s*(?:code)?\s*[:=]?\s*(\d{3})/i)
  if (statusMatch && RETRYABLE_STATUS_CODES.has(Number(statusMatch[1]))) return true

  // Anthropic/OpenAI specific
  if (msg.includes('overloaded') || msg.includes('rate_limit') ||
      msg.includes('capacity') || msg.includes('too many requests')) {
    return true
  }

  return false
}

function getRetryAfter(error: unknown): number | null {
  // Check for retry-after header in error response
  const err = error as { headers?: Record<string, string>; response?: { headers?: Record<string, string> } }
  const headers = err?.response?.headers ?? err?.headers
  if (headers) {
    const retryAfter = headers['retry-after'] ?? headers['Retry-After']
    if (retryAfter) {
      const secs = Number(retryAfter)
      if (!isNaN(secs)) return secs * 1000
    }
  }
  return null
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries   = 3,
    baseDelay    = 1000,
    maxDelay     = 30_000,
    retryOn429   = true,
    retryOnError = true,
    onRetry
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry on final attempt
      if (attempt === maxRetries) break

      // Check if error is retryable
      const is429 = String(error).includes('429') || String(error).includes('rate_limit')
      if (is429 && !retryOn429) break
      if (!is429 && !retryOnError) break
      if (!isRetryableError(error)) break

      // Calculate delay: exponential backoff with jitter
      const retryAfter = getRetryAfter(error)
      const exponential = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      const jitter = Math.random() * exponential * 0.3
      const delay = retryAfter ?? Math.round(exponential + jitter)

      log.warn('api-retry', `Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`, {
        error: String(error).slice(0, 200),
        attempt: attempt + 1
      })

      onRetry?.(attempt + 1, delay, error)

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}

/**
 * Wraps an async function to make it retriable with sensible defaults.
 * Usage: const safeFetch = retriable(() => fetch(url))
 *        const result = await safeFetch()
 */
export function retriable<T>(fn: () => Promise<T>, options?: RetryOptions): () => Promise<T> {
  return () => withRetry(fn, options)
}
