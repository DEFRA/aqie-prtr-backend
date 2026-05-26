import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  searchLocation,
  LocationBackendError
} from '#src/services/location-service.js'

/**
 * Build a minimal Response-like object matching what LocationService reads:
 * `ok`, `status`, `json()`.
 */
function fakeResponse({ status = 200, body = '{}' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body)
  }
}

describe('searchLocation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs userLocation and returns parsed JSON', async () => {
    const payload = { message: 'success', getOSPlaces: [] }
    fetch.mockResolvedValue(fakeResponse({ body: JSON.stringify(payload) }))

    const result = await searchLocation('newcastle')

    expect(result).toEqual(payload)
    const [, opts] = fetch.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ userLocation: 'newcastle' })
  })

  it('forwards trace id when provided', async () => {
    fetch.mockResolvedValue(fakeResponse({ body: '{}' }))

    await searchLocation('newcastle', { traceId: 'trace-abc' })

    const [, opts] = fetch.mock.calls[0]
    expect(opts.headers['x-cdp-request-id']).toBe('trace-abc')
  })

  it('throws LocationBackendError with status on non-2xx', async () => {
    fetch.mockResolvedValue(fakeResponse({ status: 403, body: '"Forbidden"' }))

    await expect(searchLocation('x')).rejects.toMatchObject({
      name: 'LocationBackendError',
      status: 403
    })
  })

  it('throws LocationBackendError on network failure', async () => {
    fetch.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(searchLocation('x')).rejects.toBeInstanceOf(LocationBackendError)
  })

  it('throws LocationBackendError on malformed JSON', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => JSON.parse('not json')
    })

    await expect(searchLocation('x')).rejects.toMatchObject({
      name: 'LocationBackendError'
    })
  })
})
