/**
 * Loader postcode_location.tsv → in-memory Map (NOT a collection)
 *
 * postcode_location is consumed at ingest time
 * to backfill missing easting/northing/lat/lng on facility rows. It is NOT
 * persisted as a MongoDB collection.
 *
 * The TSV is keyed by postcode OUTCODE (e.g. "AB10", "WS10") — that's the
 * area part of a UK postcode. When backfilling a facility's coords, take
 * the facility's postcode, extract the outcode, and look up.
 *
 * Exports `postcodeMap` for 30-facilities.js to import after this loader runs.
 */

import { streamValidatedTsv, toInt, toFloat } from '../lib/tsv-reader.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'

const POSTCODE_LOCATION_COLS = 6

/** outcode (e.g. "AB10") → { easting, northing, latitude, longitude } */
export const postcodeMap = new Map()

export const meta = {
  name: 'postcodeMap',
  phase: 'inMemory',
  order: 25,
  sourceTsvs: ['postcode_location.tsv'],
  targetCollection: null // NOT a collection
}

export async function run() {
  const log = loaderLogger(meta.name)
  postcodeMap.clear()
  const quarantine = createQuarantine('postcode_location.tsv', meta.name)

  let read = 0
  for await (const row of streamValidatedTsv(
    tsvPath('postcode_location.tsv'),
    POSTCODE_LOCATION_COLS,
    quarantine
  )) {
    read++
    const outcode = row.postcode_region
    if (!outcode) continue
    postcodeMap.set(outcode.trim().toUpperCase(), {
      easting: toInt(row.easting),
      northing: toInt(row.northing),
      latitude: toFloat(row.latitude),
      longitude: toFloat(row.longitude)
    })
  }
  await quarantine.flush()

  log.info(
    { read, mapSize: postcodeMap.size, malformed: quarantine.written },
    'postcode map loaded into memory'
  )
  return {
    count: postcodeMap.size,
    inMemory: true,
    malformed: quarantine.written
  }
}

/**
 * Look up coords for a facility's postcode.
 * Returns { easting, northing, latitude, longitude } or null if not found.
 */
export function lookupPostcode(postcode) {
  if (!postcode) return null
  const outcode = String(postcode).trim().toUpperCase().split(/\s+/)[0]
  return postcodeMap.get(outcode) ?? null
}
