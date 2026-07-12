import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  toFacilityDetails,
  getFacilityDetails
} from '#src/services/facility-details-service.js'

const DOC = {
  internalFacilityId: 'f-1',
  facilityCode: 'EW_EA-13989',
  facilityName: 'Brunswick Waste Reception Site',
  naceCode: '38.21',
  mainEconomicActivityName: 'Treatment and disposal of non-hazardous waste',
  mainPrtrActivityCode: '5c',
  mainPrtrActivityName: 'Disposal of non-hazardous waste',
  mainIppcActivityCode: null,
  address: {
    streetName: 'Brunswick Industrial Est',
    cityName: 'Newcastle Upon Tyne',
    postcode: 'NE13 7',
    countyName: 'Tyne and Wear',
    countryName: 'United Kingdom'
  },
  location: { type: 'Point', coordinates: [-1.643142, 55.046479] },
  nutsRegionId: 'UKC2',
  nutsRegionName: 'Northumberland and Tyne and Wear',
  riverBasinDistrictName: 'Northumbria'
}

function buildDb(doc) {
  const findOne = vi.fn().mockResolvedValue(doc)
  const collection = vi.fn(() => ({ findOne }))
  return { db: { collection }, findOne, collection }
}

describe('toFacilityDetails', () => {
  it('swaps [lng, lat] to { lat, lng } for display', () => {
    expect(toFacilityDetails(DOC).coordinates).toEqual({
      lat: 55.046479,
      lng: -1.643142
    })
  })

  it('joins the PRTR activity code and name', () => {
    expect(toFacilityDetails(DOC).activity).toBe('5c Disposal of non-hazardous waste')
  })

  it('maps nace, nuts, river basin and national id', () => {
    const dto = toFacilityDetails(DOC)
    expect(dto).toMatchObject({
      id: 'f-1',
      name: 'Brunswick Waste Reception Site',
      nationalId: 'EW_EA-13989',
      naceCode: '38.21',
      naceName: 'Treatment and disposal of non-hazardous waste',
      riverBasin: 'Northumbria',
      nutsRegion: { name: 'Northumberland and Tyne and Wear', code: 'UKC2' }
    })
    expect(dto.address).toMatchObject({
      street: 'Brunswick Industrial Est',
      city: 'Newcastle Upon Tyne',
      postcode: 'NE13 7'
    })
  })

  it('nulls the ippc code when the facility has no IPPC activity', () => {
    expect(toFacilityDetails(DOC).ippcCode).toBeNull()
  })

  it('handles a facility with no location, address, nuts or activity', () => {
    const dto = toFacilityDetails({ internalFacilityId: 'f-2', facilityName: 'X' })
    expect(dto.coordinates).toBeNull()
    expect(dto.nutsRegion).toBeNull()
    expect(dto.activity).toBeNull()
    expect(dto.address).toEqual({
      street: null, city: null, postcode: null, county: null, country: null
    })
  })
})

describe('getFacilityDetails', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries facilities by internalFacilityId with a projection', async () => {
    const { db, findOne, collection } = buildDb(DOC)

    await getFacilityDetails(db, 'f-1')

    expect(collection).toHaveBeenCalledWith('facilities')
    expect(findOne).toHaveBeenCalledWith(
      { internalFacilityId: 'f-1' },
      { projection: expect.objectContaining({ _id: 0, facilityName: 1, location: 1 }) }
    )
  })

  it('returns the shaped DTO when found', async () => {
    const { db } = buildDb(DOC)
    const out = await getFacilityDetails(db, 'f-1')
    expect(out.nationalId).toBe('EW_EA-13989')
    expect(out.coordinates).toEqual({ lat: 55.046479, lng: -1.643142 })
  })

  it('returns null when the facility does not exist', async () => {
    const { db } = buildDb(null)
    expect(await getFacilityDetails(db, 'f-missing')).toBeNull()
  })
})
