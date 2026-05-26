import { bngToLatLng } from "#src/services/coords.js";

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
    lng,

  }
}

/**
 * Map the raw location backend response in the public shape
 * @param {string} query - The original user query
 * @param {object} raw - raw upstream payload
 * @return {{ query: string, count: number, results: object[] }}
 */

export function mapLocationResponse(query, raw) {
  const matches = Array.isArray(raw?.getOSPlaces) ? raw.getOSPlaces : []
  const results = matches.map((m) => mapEntry(m.GAZETTEER_ENTRY))
  return { query, count: results.length, results }
}
