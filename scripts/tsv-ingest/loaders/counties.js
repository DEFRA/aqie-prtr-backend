/**
 * Loader: county.tsv → counties collection
 *
 * _id = countyId ( int kept as the key since names
 * are not stable enough).
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const COUNTY_COLS = 2

export const meta = {
  name: 'counties',
  phase: 'reference',
  order: 17,
  sourceTsvs: ['county.tsv'],
  targetCollection: 'counties'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'countyId')
  const quarantine = createQuarantine('county.tsv', meta.name)

  for (const row of await readAllValidatedRows(
    tsvPath('county.tsv'),
    COUNTY_COLS,
    quarantine
  )) {
    const id = toInt(row.county_id)
    if (id === null) continue
    await batcher.add({
      countyId: id,
      name: row.county_name
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    { written: batcher.written, malformed: quarantine.written },
    'counties loader complete'
  )
  return { count: batcher.written, malformed: quarantine.written }
}
