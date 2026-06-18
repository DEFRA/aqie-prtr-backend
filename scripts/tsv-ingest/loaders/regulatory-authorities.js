/**
 * Loader: regulatory_authority.tsv → regulatoryAuthorities collection
 *
 * ~450 documents — UK local authority codes (E### / W###).
 * Each has lat/lng + easting/northing.
 *
 * `code` is the document _id. `location` is stored as GeoJSON Point so we
 * can geo-query "regulators near me" later.
 *
 * Source quality note: the same `code` can appear on more than one row
 * (e.g. "BEIS" is reused for BEIS dept and successor DESNZ). When that
 * happens, the second-seen row wins the _id and the earlier one is
 * written to ingestFailedRecords for traceability.
 */

import {
  streamValidatedTsv,
  toInt,
  toFloat,
  toBool
} from '../lib/tsv-reader.js'

const REG_AUTH_COLS = 9
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

export const meta = {
  name: 'regulatoryAuthorities',
  phase: 'reference',
  order: 11,
  sourceTsvs: ['regulatory_authority.tsv'],
  targetCollection: 'regulatory_authorities'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'code')
  const quarantine = createQuarantine('regulatory_authority.tsv', meta.name)

  // On each duplicate code, quarantine the row currently sitting under that
  // code (about to be overwritten) and write the new one. Final row per
  // code stays in the collection.
  const lastRowByCode = new Map()

  let read = 0
  let withGeo = 0
  let nullCode = 0
  let duplicateCode = 0

  for await (const row of streamValidatedTsv(
    tsvPath('regulatory_authority.tsv'),
    REG_AUTH_COLS,
    quarantine
  )) {
    read++
    const code = row.regulatory_authority_code

    if (!code) {
      nullCode++
      await quarantine.add({
        row,
        reason: 'regulatory_authority_code is NULL — cannot be _id',
        ricardoRowId: toInt(row.regulatory_authority_id)
      })
      continue
    }

    if (lastRowByCode.has(code)) {
      const beingOverwritten = lastRowByCode.get(code)
      await quarantine.add({
        row: beingOverwritten,
        reason: `duplicate code "${code}" in source — this row was overwritten by a later row`,
        ricardoRowId: toInt(beingOverwritten.regulatory_authority_id)
      })
      duplicateCode++
    }
    lastRowByCode.set(code, row)

    const lat = toFloat(row.regulatory_authority_latitude)
    const lng = toFloat(row.regulatory_authority_longitude)
    const hasValidGeo =
      lat !== null &&
      lng !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    if (hasValidGeo) withGeo++

    const doc = {
      code,
      name: row.regulatory_authority_name,
      isLocalAuthority: toBool(row.local_authority),
      easting: toInt(row.regulatory_authority_easting),
      northing: toInt(row.regulatory_authority_northing),
      laqmId: row.laqm_id,
      ricardoId: toInt(row.regulatory_authority_id),
      // Only attach `location` when the coords pass the partial-filter check.
      // The 2dsphere partial index expects lng in [-180,180], lat in [-90,90].
      ...(hasValidGeo && {
        location: { type: 'Point', coordinates: [lng, lat] }
      })
    }
    await batcher.add(doc)
  }
  await batcher.flush()
  await quarantine.flush()

  if (nullCode > 0) {
    log.warn(
      { nullCode },
      'rows with NULL regulatory_authority_code quarantined'
    )
  }
  if (duplicateCode > 0) {
    log.warn(
      { duplicateCode },
      'rows with duplicate codes — earlier row quarantined, later row wins _id'
    )
  }
  log.info(
    {
      read,
      written: batcher.written,
      withGeo,
      nullCode,
      duplicateCode,
      quarantined: quarantine.written
    },
    'regulatoryAuthorities loader complete'
  )
  return {
    count: batcher.written,
    withGeo,
    nullCode,
    duplicateCode,
    quarantined: quarantine.written
  }
}
