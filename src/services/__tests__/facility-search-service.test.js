import { describe, it, expect, vi } from 'vitest'
import { searchFacilities } from '#src/services/facility-search-service.js'

const YEAR_2024 = 2024

function buildDb(count, docs) {
  const toArray = vi.fn().mockResolvedValue(docs)
  const chain = {
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray
  }
  const find = vi.fn(() => chain)
  const countDocuments = vi.fn().mockResolvedValue(count)
  const collection = vi.fn(() => ({ find, countDocuments }))
  return { db: { collection }, find, countDocuments }
}

describe('searchFacilities', () => {
  it('name → case-insensitive regex on facilityName, returns results + total', async () => {
    const { db, find } = buildDb(1, [{ id: 'f-1' }])

    const out = await searchFacilities(db, {
      searchType: 'name',
      term: 'brunswick',
      skip: 0,
      limit: 10
    })

    expect(find.mock.calls[0][0]).toEqual({ facilityName: /brunswick/i })
    expect(out).toEqual({ results: [{ id: 'f-1' }], total: 1 })
  })

  it('region → $or on countyName and nutsRegionName', async () => {
    const { db, find } = buildDb(0, [])
    await searchFacilities(db, {
      searchType: 'region',
      term: 'tyne',
      skip: 0,
      limit: 10
    })
    expect(find.mock.calls[0][0]).toEqual({
      $or: [{ 'address.countyName': /tyne/i }, { nutsRegionName: /tyne/i }]
    })
  })

  it('river-basin → regex on riverBasinDistrictName', async () => {
    const { db, find } = buildDb(0, [])
    await searchFacilities(db, {
      searchType: 'river-basin',
      term: 'humber',
      skip: 0,
      limit: 10
    })
    expect(find.mock.calls[0][0]).toEqual({ riverBasinDistrictName: /humber/i })
  })

  it('year → reportingYears equals the parsed year', async () => {
    const { db, find } = buildDb(0, [])
    await searchFacilities(db, {
      searchType: 'year',
      term: '2024',
      skip: 0,
      limit: 10
    })
    expect(find.mock.calls[0][0]).toEqual({ reportingYears: YEAR_2024 })
  })

  it('non-numeric year → a filter that matches nothing', async () => {
    const { db, find } = buildDb(0, [])
    await searchFacilities(db, {
      searchType: 'year',
      term: 'abc',
      skip: 0,
      limit: 10
    })
    expect(find.mock.calls[0][0]).toEqual({ _id: null })
  })

  it('escapes regex metacharacters in the term', async () => {
    const { db, find } = buildDb(0, [])
    await searchFacilities(db, {
      searchType: 'name',
      term: 'a.b*c',
      skip: 0,
      limit: 10
    })
    expect(find.mock.calls[0][0]).toEqual({ facilityName: /a\.b\*c/i })
  })

  it('unknown search type → a filter that matches nothing', async () => {
    const { db, find } = buildDb(0, [])
    await searchFacilities(db, {
      searchType: 'colour',
      term: 'x',
      skip: 0,
      limit: 10
    })
    expect(find.mock.calls[0][0]).toEqual({ _id: null })
  })
})
