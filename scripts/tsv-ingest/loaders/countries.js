/**
 * Loader: country.tsv → countries collection
 *
 * _id = ricardoCountryId (the TSV doesn't have ISO codes,
 * only internal int ID). Country names denormalised on records
 * use this id for join.
 *
 * If ISO 3166 codes are needed later, this collection can be augmented
 * with `isoCode` via a curated mapping.
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const COUNTRY_COLS = 2

export const meta = {
  name: 'countries',
  phase: 'reference',
  order: 18,
  sourceTsvs: ['country.tsv'],
  targetCollection: 'countries'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'ricardoCountryId')
  const quarantine = createQuarantine('country.tsv', meta.name)

  for (const row of await readAllValidatedRows(
    tsvPath('country.tsv'),
    COUNTRY_COLS,
    quarantine
  )) {
    const id = toInt(row.country_id)
    if (id === null) continue
    await batcher.add({
      ricardoCountryId: id,
      name: row.country_name
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    { written: batcher.written, malformed: quarantine.written },
    'countries loader complete'
  )
  return { count: batcher.written, malformed: quarantine.written }
}
