import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('#src/services/facility-search-service.js', () => ({
  searchFacilities: vi.fn()
}))

import { statusCodes } from '#src/common/constants/status-codes.js'
import {
  handleFacilitySearch,
  facilitySearch
} from '#src/routes/facility-search.js'
import { searchFacilities } from '#src/services/facility-search-service.js'

const EXPECTED_TOTAL_PAGES = 5

function buildH() {
  const code = vi.fn((c) => ({ statusCode: c }))
  const response = vi.fn(() => ({ code }))
  return { h: { response }, response, code }
}

const fakeDb = { collection: vi.fn() }

describe('handleFacilitySearch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a paginated envelope from the service results', async () => {
    searchFacilities.mockResolvedValue({ results: [{ id: 'f-1' }], total: 42 })
    const { h, response, code } = buildH()

    await handleFacilitySearch(
      {
        query: { searchType: 'name', q: 'brunswick', page: 1, perPage: 10 },
        db: fakeDb
      },
      h
    )

    expect(response.mock.calls[0][0]).toMatchObject({
      count: 1,
      total: 42,
      page: 1,
      perPage: 10,
      totalPages: EXPECTED_TOTAL_PAGES
    })
    expect(code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('passes term and skip/limit derived from page/perPage', async () => {
    searchFacilities.mockResolvedValue({ results: [], total: 0 })
    const { h } = buildH()

    await handleFacilitySearch(
      {
        query: { searchType: 'name', q: 'x', page: 3, perPage: 10 },
        db: fakeDb
      },
      h
    )

    expect(searchFacilities).toHaveBeenCalledWith(fakeDb, {
      searchType: 'name',
      term: 'x',
      skip: 20,
      limit: 10
    })
  })

  it('wraps an unexpected service error as a Boom internal server error', async () => {
    searchFacilities.mockRejectedValue(new Error('mongo down'))
    const { h } = buildH()

    await expect(
      handleFacilitySearch(
        {
          query: { searchType: 'name', q: 'x', page: 1, perPage: 10 },
          db: fakeDb
        },
        h
      )
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: statusCodes.internalServerError }
    })
  })
})

describe('facilitySearch route', () => {
  const schema = () => facilitySearch[0].options.validate.query

  it('is wired GET /facilities/search with query validation', () => {
    expect(facilitySearch[0]).toMatchObject({
      method: 'GET',
      path: '/facilities/search'
    })
    expect(facilitySearch[0].handler).toBe(handleFacilitySearch)
  })

  it('rejects an invalid searchType or a missing q', () => {
    expect(
      schema().validate({ searchType: 'colour', q: 'x' }).error
    ).toBeDefined()
    expect(schema().validate({ searchType: 'name' }).error).toBeDefined()
  })

  it('defaults page and perPage', () => {
    const { value, error } = schema().validate({ searchType: 'name', q: 'x' })
    expect(error).toBeUndefined()
    expect(value).toMatchObject({ page: 1, perPage: 10 })
  })
})
