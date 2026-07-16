import { describe, it, expect, vi } from 'vitest'
import { findFacilitiesNearby } from '#src/services/facility-service.js'

const METRES_PER_MILE = 1609.344

// Minimal chainable mock: db.collection().aggregate().toArray()
function buildDb(facetResult) {
  const toArray = vi
    .fn()
    .mockResolvedValue(facetResult === undefined ? [] : [facetResult])
  const aggregate = vi.fn().mockReturnValue({ toArray })
  const collection = vi.fn().mockReturnValue({ aggregate })
  return { db: { collection }, aggregate, collection }
}

describe('findFacilitiesNearby', () => {
  it('builds a $geoNear + $facet pipeline and returns { results, total }', async () => {
    const { db, aggregate, collection } = buildDb({
      results: [{ id: 'f-1', name: 'Brunswick', distanceMiles: 0.1 }],
      totalCount: [{ total: 657 }]
    })

    const out = await findFacilitiesNearby(db, {
      lng: -1.6,
      lat: 55.0,
      radiusMiles: 50,
      skip: 10,
      limit: 10
    })

    expect(collection).toHaveBeenCalledWith('facilities')

    const pipeline = aggregate.mock.calls[0][0]
    const geoNear = pipeline[0].$geoNear

    expect(geoNear).toMatchObject({
      near: { type: 'Point', coordinates: [-1.6, 55.0] },
      distanceField: 'distanceMiles',
      spherical: true
    })
    // distance returned in miles; radius filter passed to Mongo in metres
    expect(geoNear.distanceMultiplier).toBeCloseTo(1 / METRES_PER_MILE)
    expect(geoNear.maxDistance).toBeCloseTo(50 * METRES_PER_MILE)
    // query predicate must mirror the partial index filter so the index is used
    expect(geoNear.query).toEqual({
      'location.coordinates.0': { $gte: -180, $lte: 180 },
      'location.coordinates.1': { $gte: -90, $lte: 90 }
    })

    const facet = pipeline[1].$facet
    expect(facet.results[0]).toEqual({ $skip: 10 })
    expect(facet.results[1]).toEqual({ $limit: 10 })
    expect(facet.results[2].$project).toMatchObject({
      _id: 0,
      id: '$internalFacilityId',
      name: '$facilityName',
      activity: '$mainPrtrActivityName',
      distanceMiles: { $round: ['$distanceMiles', 1] }
    })
    expect(facet.totalCount).toEqual([{ $count: 'total' }])

    expect(out).toEqual({
      results: [{ id: 'f-1', name: 'Brunswick', distanceMiles: 0.1 }],
      total: 657
    })
  })

  it('returns empty results and total 0 when nothing is in range', async () => {
    const { db } = buildDb({ results: [], totalCount: [] })
    const out = await findFacilitiesNearby(db, {
      lng: 0,
      lat: 0,
      radiusMiles: 5,
      skip: 0,
      limit: 10
    })
    expect(out).toEqual({ results: [], total: 0 })
  })

  it('handles aggregate returning no facet document at all', async () => {
    const { db } = buildDb(undefined) // toArray resolves to []
    const out = await findFacilitiesNearby(db, {
      lng: 0,
      lat: 0,
      radiusMiles: 5,
      skip: 0,
      limit: 10
    })
    expect(out).toEqual({ results: [], total: 0 })
  })
})
