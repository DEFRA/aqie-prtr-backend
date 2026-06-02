import { describe, it, expect, vi } from 'vitest'
import { mapLocationResponse } from '#src/services/location-mapper.js'

const newcastle = {
  GAZETTEER_ENTRY: {
    ID: 'newcastle-upon-tyne-newcastle-upon-tyne',
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

const validEntry = newcastle
const malformedNoCoords = {
  GAZETTEER_ENTRY: {
    ID: 'broken',
    NAME1: 'Broken',
    LOCAL_TYPE: 'Village'
    // GEOMETRY_X and GEOMETRY_Y missing
  }
}
const malformedNoEntry = {} // GAZETTEER_ENTRY missing entirely

describe('mapLocationResponse', () => {
  it('maps a match to clean shape', () => {
    const r = mapLocationResponse('newcastle', { getOSPlaces: [newcastle] })
    expect(r.query).toBe('newcastle')
    expect(r.count).toBe(1)
    expect(r.results[0]).toMatchObject({
      id: 'newcastle-upon-tyne-newcastle-upon-tyne',
      name: 'Newcastle upon Tyne',
      localType: 'City'
    })
    expect(r.results[0].lat).toBeCloseTo(54.978, 1)
    expect(r.results[0].lng).toBeCloseTo(-1.617, 1)
  })

  it('drops GAZETTEER_ENTRY and GEOMETRY fields', () => {
    const r = mapLocationResponse('x', { getOSPlaces: [newcastle] })
    expect(r.results[0].GAZETTEER_ENTRY).toBeUndefined()
    expect(r.results[0].GEOMETRY_X).toBeUndefined()
  })

  it('uses null for missing optional fields', () => {
    const minimal = {
      GAZETTEER_ENTRY: {
        ID: 'foo',
        NAME1: 'Foo',
        LOCAL_TYPE: 'Village',
        GEOMETRY_X: 400000,
        GEOMETRY_Y: 300000
      }
    }
    const r = mapLocationResponse('foo', { getOSPlaces: [minimal] })
    expect(r.results[0].districtBorough).toBeNull()
    expect(r.results[0].region).toBeNull()
  })

  it('returns empty results when getOSPlaces is empty or missing', () => {
    expect(mapLocationResponse('x', { getOSPlaces: [] }).results).toEqual([])
    expect(mapLocationResponse('x', {}).results).toEqual([])
    expect(mapLocationResponse('x', null).results).toEqual([])
  })
})

describe('mapLocationResponse — shape validation', () => {
  it('throws when getOSPlaces is not an array', () => {
    expect(() =>
      mapLocationResponse('x', { getOSPlaces: 'not an array' })
    ).toThrow(/Expected raw\.getOSPlaces to be an array, got string/)
  })

  it('throws when getOSPlaces is an object', () => {
    expect(() =>
      mapLocationResponse('x', { getOSPlaces: { foo: 'bar' } })
    ).toThrow(/got object/)
  })

  it('throws when getOSPlaces is null', () => {
    expect(() => mapLocationResponse('x', { getOSPlaces: null })).toThrow(
      /got object/
    )
  })
})

describe('mapLocationResponse — per-entry guards', () => {
  it('skips entries missing GAZETTEER_ENTRY', () => {
    const logger = { warn: vi.fn() }
    const r = mapLocationResponse(
      'x',
      { getOSPlaces: [validEntry, malformedNoEntry] },
      logger
    )
    expect(r.count).toBe(1)
    expect(r.results[0].id).toBe('newcastle-upon-tyne-newcastle-upon-tyne')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('skips entries missing coordinates', () => {
    const logger = { warn: vi.fn() }
    const r = mapLocationResponse(
      'x',
      { getOSPlaces: [malformedNoCoords] },
      logger
    )
    expect(r.count).toBe(0)
    expect(r.results).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ entry: expect.any(Object) }),
      expect.stringContaining('Skipping malformed')
    )
  })

  it('skips entries missing ID', () => {
    const noId = {
      GAZETTEER_ENTRY: {
        NAME1: 'NoId',
        LOCAL_TYPE: 'Village',
        GEOMETRY_X: 400000,
        GEOMETRY_Y: 300000
      }
    }
    const r = mapLocationResponse('x', { getOSPlaces: [noId] })
    expect(r.count).toBe(0)
  })

  it('works without a logger (logger arg optional)', () => {
    const r = mapLocationResponse(
      'x',
      { getOSPlaces: [malformedNoEntry] }
      // no logger passed
    )
    expect(r.count).toBe(0) // doesn't throw
  })
})
