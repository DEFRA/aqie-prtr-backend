import OsGridRefImport from 'mt-osgridref'

/**
 * convert OS BNG GAZETTEER_ENTRY.GEOMETRY_X/Y to WGS84 lat/lon
 * @param {{ x: number, y: number }} BNG
 * @returns {{ lat: nummber, lng: number }}
 */
const OsGridRef = OsGridRefImport?.default ?? OsGridRefImport

export function bngToLatLng({ x, y }) {
  const point = new OsGridRef(x, y)
  const { _lat, _lon } = OsGridRef.osGridToLatLong(point)
  return { lat: _lat, lng: _lon }
}
