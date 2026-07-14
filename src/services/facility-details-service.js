/**
 * Facility details: the reference/metadata view of a single facility.
 * Separate from facility-record (which is the per-year releases & transfers).
 */

const EMPTY = {}

function toActivity(doc) {
  return (
    [doc.mainPrtrActivityCode, doc.mainPrtrActivityName]
      .filter(Boolean)
      .join(' ') || null
  )
}

function toAddress(address) {
  return {
    street: address.streetName ?? null,
    city: address.cityName ?? null,
    postcode: address.postcode ?? null,
    county: address.countyName ?? null,
    country: address.countryName ?? null
  }
}

/** Mongo stores GeoJSON [lng, lat]; the screen shows (Lat, Lon). */
function toCoordinates(location) {
  const coordinates = location?.coordinates
  if (!coordinates) {
    return null
  }
  return { lat: coordinates[1], lng: coordinates[0] }
}

function toNutsRegion(doc) {
  if (!doc.nutsRegionName) {
    return null
  }
  return { name: doc.nutsRegionName, code: doc.nutsRegionId ?? null }
}

/**
 * Shape a facility document into the details-page DTO.
 * Pure — exported for unit testing.
 */
export function toFacilityDetails(doc) {
  return {
    id: doc.internalFacilityId,
    name: doc.facilityName,
    nationalId: doc.facilityCode,
    activity: toActivity(doc),
    ippcCode: doc.mainIppcActivityCode ?? null,
    address: toAddress(doc.address ?? EMPTY),
    coordinates: toCoordinates(doc.location),
    nutsRegion: toNutsRegion(doc),
    naceCode: doc.naceCode ?? null,
    naceName: doc.mainEconomicActivityName ?? null,
    riverBasin: doc.riverBasinDistrictName ?? null
  }
}

/**
 * Fetch a facility's details by its stable internalFacilityId.
 *
 * @param {import('mongodb').Db} db
 * @param {string} internalFacilityId
 * @returns {Promise<object|null>} null when the facility does not exist
 */
export async function getFacilityDetails(db, internalFacilityId) {
  const doc = await db.collection('facilities').findOne(
    { internalFacilityId },
    {
      projection: {
        _id: 0,
        internalFacilityId: 1,
        facilityCode: 1,
        facilityName: 1,
        naceCode: 1,
        mainEconomicActivityName: 1,
        mainPrtrActivityCode: 1,
        mainPrtrActivityName: 1,
        mainIppcActivityCode: 1,
        mainIppcActivityName: 1,
        address: 1,
        location: 1,
        nutsRegionId: 1,
        nutsRegionName: 1,
        riverBasinDistrictCode: 1,
        riverBasinDistrictName: 1
      }
    }
  )

  if (!doc) {
    return null
  }

  return toFacilityDetails(doc)
}
