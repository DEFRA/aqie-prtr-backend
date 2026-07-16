import { describe, it, expect, vi, beforeEach } from 'vitest'
import { statusCodes } from '#src/common/constants/status-codes.js'

vi.mock('#src/services/facility-service.js', () => ({
  findFacilitiesNearby: vi.fn()
}))

import { handleFacilitiesNearby, facilities } from '#src/routes/facilities.js'
import { findFacilitiesNearby } from '#src/services/facility-service.js'

function buildH() {
  const code = vi.fn((c) => ({ statusCode: c }))
  const response = vi.fn(() => ({ code }))
  return { h: { response }, response, code }
}

const fakeDb = { collection: vi.fn() } // request.db is a property, not a function

describe('handleFacilitiesNearby', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a paginated envelope from the service results', async () => {
    findFacilitiesNearby.mockResolvedValue({
      results: [
        {
          id: 'f-1',
          name: 'Brunswick',
          activity: 'Disposal',
          distanceMiles: 0.1,
          latestReportingYear: 2024,
          latestReportingTypes: ['wasteTransfers']
        }
      ],
      total: 657
    })
    const { h, response, code } = buildH()

    await handleFacilitiesNearby(
      {
        query: { lat: 55, lng: -1.6, radius: 50, page: 1, perPage: 10 },
        db: fakeDb
      },
      h
    )

    expect(response.mock.calls[0][0]).toMatchObject({
      count: 1,
      total: 657,
      page: 1,
      perPage: 10,
      totalPages: 66
    })
    expect(code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('passes db, radiusMiles and skip/limit derived from page/perPage', async () => {
    findFacilitiesNearby.mockResolvedValue({ results: [], total: 0 })
    const { h } = buildH()

    await handleFacilitiesNearby(
      {
        query: { lat: 55, lng: -1.6, radius: 50, page: 3, perPage: 10 },
        db: fakeDb
      },
      h
    )

    expect(findFacilitiesNearby).toHaveBeenCalledWith(fakeDb, {
      lat: 55,
      lng: -1.6,
      radiusMiles: 50,
      skip: 20,
      limit: 10
    })
  })

  it('reports totalPages of 1 when there are no results', async () => {
    findFacilitiesNearby.mockResolvedValue({ results: [], total: 0 })
    const { h, response } = buildH()

    await handleFacilitiesNearby(
      {
        query: { lat: 55, lng: -1.6, radius: 50, page: 1, perPage: 10 },
        db: fakeDb
      },
      h
    )

    expect(response.mock.calls[0][0]).toMatchObject({
      count: 0,
      total: 0,
      totalPages: 1
    })
  })

  it('wraps an unexpected service error as a Boom 500', async () => {
    findFacilitiesNearby.mockRejectedValue(new Error('mongo down'))
    const { h } = buildH()

    await expect(
      handleFacilitiesNearby(
        {
          query: { lat: 55, lng: -1.6, radius: 50, page: 1, perPage: 10 },
          db: fakeDb
        },
        h
      )
    ).rejects.toThrow()
  })
})

describe('facilities route', () => {
  it('is wired GET /facilities/nearby with query validation', () => {
    expect(facilities[0]).toMatchObject({
      method: 'GET',
      path: '/facilities/nearby'
    })
    expect(facilities[0].handler).toBe(handleFacilitiesNearby)
    expect(facilities[0].options.validate.query).toBeDefined()
  })

  it('defaults page, perPage and radius in the query schema', () => {
    const { value, error } = facilities[0].options.validate.query.validate({
      lat: 55,
      lng: -1.6
    })
    expect(error).toBeUndefined()
    expect(value).toMatchObject({ page: 1, perPage: 10, radius: 50 })
  })

  it('rejects out-of-range or missing lat/lng', () => {
    const schema = facilities[0].options.validate.query
    expect(schema.validate({ lat: 999, lng: -1.6 }).error).toBeDefined()
    expect(schema.validate({ lng: -1.6 }).error).toBeDefined() // lat required
  })
})
