import { describe, it, expect } from 'vitest'
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
        ID: 'foo', NAME1: 'Foo', LOCAL_TYPE: 'Village',
        GEOMETRY_X: 400000, GEOMETRY_Y: 300000
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
