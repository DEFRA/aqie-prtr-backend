/**
 * Facility details: the reference/metadata view of a single facility.
 * Separate from facility-record (which is the per-year releases & transfers).
 */

/**
 * Shape a facility document into the details-page DTO.
 * Pure — exported for unit testing.
 *
 * @param {object} doc - Projected `facilities` document
 * @returns {object}
 */
 export function toFacilityDetails(doc) {
  const coordinates = doc.location?.coordinates ?? null // stored [lng, lat]
  const activity = [doc.mainPrtrActivityCode, doc.mainPrtrActivityName]
    .filter(Boolean)
    .join(' ')

  return {
    id: doc.internalFacilityId,
    name: doc.facilityName,
    nationalId: doc.facilityCode,
    activity: activity || null,
    // Most facilities have no IPPC activity recorded; the FE renders "—".
    ippcCode: doc.mainIppcActivityCode ?? null,
    address: {
      street: doc.address?.streetName ?? null,
      city: doc.address?.cityName ?? null,
      postcode: doc.address?.postcode ?? null,
      county: doc.address?.countyName ?? null,
      country: doc.address?.countryName ?? null
    },
    // Swap to (lat, lon) for display — Mongo stores GeoJSON [lng, lat].
    coordinates: coordinates
      ? { lat: coordinates[1], lng: coordinates[0] }
      : null,
    nutsRegion: doc.nutsRegionName
      ? { name: doc.nutsRegionName, code: doc.nutsRegionId ?? null }
      : null,
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
