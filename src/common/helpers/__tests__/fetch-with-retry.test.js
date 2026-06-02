import { describe, it, expect, beforeEach, vi } from 'vitest'

import { fetchWithRetry } from '#src/common/helpers/fetch-with-retry.js'

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the response when fetch succeeds on first attempt', async () => {
    const expected = { ok: true, status: 200 }
    const fetchFn = vi.fn().mockResolvedValue(expected)

    const result = await fetchWithRetry(fetchFn, { operationName: 'test' })

    expect(result).toBe(expected)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('passes an AbortSignal to fetchFn', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 })

    await fetchWithRetry(fetchFn, { operationName: 'test' })

    const signal = fetchFn.mock.calls[0][0]
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('retries on failure when maxRetries > 0 and eventually succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const result = await fetchWithRetry(fetchFn, {
      operationName: 'test',
      maxRetries: 1,
      retryDelayMs: 1
    })

    expect(result).toEqual({ ok: true, status: 200 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('rethrows the last error after exhausting retries', async () => {
    const finalError = new Error('persistent failure')
    const fetchFn = vi.fn().mockRejectedValue(finalError)

    await expect(
      fetchWithRetry(fetchFn, {
        operationName: 'test',
        maxRetries: 2,
        retryDelayMs: 1
      })
    ).rejects.toBe(finalError)

    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('does not retry when maxRetries is 0 (default)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(
      fetchWithRetry(fetchFn, { operationName: 'test' })
    ).rejects.toThrow('boom')

    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
