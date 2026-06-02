import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock is hoisted — intercepts the import before locations.js evaluates.
vi.mock('#src/services/location-service.js', () => ({
  searchLocation: vi.fn(),
  LocationBackendError: class LocationBackendError extends Error {
    constructor(message, { status, cause } = {}) {
      super(message)
      this.name = 'LocationBackendError'
      this.status = status ?? null
      if (cause) this.cause = cause
    }
  }
}))

import { handleLocationsSearch, locations } from '#src/routes/locations.js'
import {
  searchLocation,
  LocationBackendError
} from '#src/services/location-service.js'

const newcastleMatch = {
  GAZETTEER_ENTRY: {
    ID: 'newcastle-upon-tyne',
    NAME1: 'Newcastle upon Tyne',
    LOCAL_TYPE: 'City',
    GEOMETRY_X: 425030,
    GEOMETRY_Y: 564310,
    DISTRICT_BOROUGH: 'Newcastle upon Tyne',
    COUNTY_UNITARY: 'Newcastle upon Tyne',
    REGION: 'North East',
    POSTCODE_DISTRICT: 'NE1'
  }
}

/**
 * Minimal ResponseToolkit mock supporting the `.response(payload).code(status)` chain.
 */
function buildResponseToolkit() {
  const responseBuilder = { code: vi.fn().mockReturnThis() }
  const h = { response: vi.fn().mockReturnValue(responseBuilder) }
  return { h, responseBuilder }
}

describe('handleLocationsSearch', () => {
  let request
  let h
  let responseBuilder

  beforeEach(() => {
    vi.clearAllMocks()
    ;({ h, responseBuilder } = buildResponseToolkit())
    request = {
      query: { q: 'newcastle' },
      headers: { 'x-cdp-request-id': 'trace-abc' }
    }
  })

  it('calls searchLocation with the query and trace id from headers', async () => {
    searchLocation.mockResolvedValue({
      message: 'success',
      getOSPlaces: [newcastleMatch]
    })

    await handleLocationsSearch(request, h)

    expect(searchLocation).toHaveBeenCalledTimes(1)
    expect(searchLocation).toHaveBeenCalledWith('newcastle', {
      traceId: 'trace-abc'
    })
  })

  it('responds 200 with the mapped public payload on upstream success', async () => {
    searchLocation.mockResolvedValue({
      message: 'success',
      getOSPlaces: [newcastleMatch]
    })

    await handleLocationsSearch(request, h)

    const payload = h.response.mock.calls[0][0]
    expect(payload).toMatchObject({ query: 'newcastle', count: 1 })
    expect(payload.results[0]).toMatchObject({
      id: 'newcastle-upon-tyne',
      name: 'Newcastle upon Tyne',
      lat: expect.any(Number),
      lng: expect.any(Number)
    })
    expect(responseBuilder.code).toHaveBeenCalledWith(200)
  })

  it('drops OS-specific fields from the response (mapper contract)', async () => {
    searchLocation.mockResolvedValue({
      message: 'success',
      getOSPlaces: [newcastleMatch]
    })

    await handleLocationsSearch(request, h)

    const result = h.response.mock.calls[0][0].results[0]
    expect(result.GAZETTEER_ENTRY).toBeUndefined()
    expect(result.GEOMETRY_X).toBeUndefined()
    expect(result.GEOMETRY_Y).toBeUndefined()
  })

  it('returns Boom.badGateway 502 when the service throws LocationBackendError', async () => {
    searchLocation.mockRejectedValue(
      new LocationBackendError('upstream down', { status: 503 })
    )

    const result = await handleLocationsSearch(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(502)
    expect(result.output.payload.message).toBe(
      'Location service is currently unavailable'
    )
    expect(h.response).not.toHaveBeenCalled()
  })

  it('rethrows non-LocationBackendError errors so Hapi returns 500', async () => {
    const unexpectedError = new TypeError('something else went wrong')
    searchLocation.mockRejectedValue(unexpectedError)

    await expect(handleLocationsSearch(request, h)).rejects.toBe(
      unexpectedError
    )
    expect(h.response).not.toHaveBeenCalled()
  })

  it('handles a missing trace header without crashing', async () => {
    searchLocation.mockResolvedValue({ message: 'success', getOSPlaces: [] })
    request.headers = {}

    await handleLocationsSearch(request, h)

    expect(searchLocation).toHaveBeenCalledWith(
      'newcastle',
      expect.objectContaining({ traceId: undefined })
    )
  })

  it('returns an empty results list when upstream has no matches', async () => {
    searchLocation.mockResolvedValue({ message: 'success', getOSPlaces: [] })

    await handleLocationsSearch(request, h)

    const payload = h.response.mock.calls[0][0]
    expect(payload.count).toBe(0)
    expect(payload.results).toEqual([])
    expect(responseBuilder.code).toHaveBeenCalledWith(200)
  })
})

describe('locations route export', () => {
  it('wires GET /locations/search to the named handler with the Joi schema', () => {
    expect(locations).toHaveLength(1)
    const route = locations[0]
    expect(route.method).toBe('GET')
    expect(route.path).toBe('/locations/search')
    expect(route.handler).toBe(handleLocationsSearch)
    expect(route.options.validate.query).toBeDefined()
    expect(route.options.tags).toEqual(['api', 'locations'])
  })
})
