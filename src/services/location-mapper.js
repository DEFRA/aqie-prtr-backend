import { bngToLatLng } from '#src/services/coords.js'

/**
 * Map a single GAZETTEER_ENTRY in to clean shape
 * Drop OS-specific fields (URIs, MBR bounds, Web Mercator coords)
 * @param {object} gazEntry
 * @returns {object}
 */

function mapEntry(gazEntry) {
  const { lat, lng } = bngToLatLng({
    x: gazEntry.GEOMETRY_X,
    y: gazEntry.GEOMETRY_Y
  })

  return {
    id: gazEntry.ID,
    name: gazEntry.NAME1,
    localType: gazEntry.LOCAL_TYPE,
    districtBorough: gazEntry.DISTRICT_BOROUGH ?? null,
    countyUnitary: gazEntry.COUNTY_UNITARY ?? null,
    region: gazEntry.REGION ?? null,
    postcodeDistrict: gazEntry.POSTCODE_DISTRICT ?? null,
    lat,
    lng
  }
}

/**
 * Map the raw location backend response in the public shape
 * @param {string} query - The original user query
 * @param {object} raw - raw upstream payload
 * @return {{ query: string, count: number, results: object[] }}
 */

export function mapLocationResponse(query, raw, logger) {
  if (raw?.getOSPlaces !== undefined && !Array.isArray(raw.getOSPlaces)) {
    throw new Error(
      `Expected raw.getOSPlaces to be an array, got ${typeof raw.getOSPlaces}`
    )
  }

  const matches = Array.isArray(raw?.getOSPlaces) ? raw.getOSPlaces : []
  const results = []
  for (const m of matches) {
    const entry = m?.GAZETTEER_ENTRY
    if (
      entry?.ID == null ||
      entry?.GEOMETRY_X == null ||
      entry?.GEOMETRY_Y == null
    ) {
      logger?.warn(
        { entry },
        'Skipping malformed gazetteer entry: missing ID or coordinates'
      )
      continue
    }
    results.push(mapEntry(entry))
  }

  return { query, count: results.length, results }
}
