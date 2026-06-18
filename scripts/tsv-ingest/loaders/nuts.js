/**
 * Loader: nuts.tsv → nutsRegions collection
 *
 * NUTS hierarchy derived from the code structure:
 *   UK    → level 1 (country)
 *   UKG   → level 2 (region group)
 *   UKG3  → level 3 (region)
 *   UKG34 → level 4 (sub-region)
 *
 * parentCode is derived by stripping the last character of the code.
 *
 * _id = NUTS code (e.g. "UKG34").
 */

import { streamValidatedTsv, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const NUTS_COLS = 3

export const meta = {
  name: 'nutsRegions',
  phase: 'reference',
  order: 14,
  sourceTsvs: ['nuts.tsv'],
  targetCollection: 'nuts_regions'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'code')
  const quarantine = createQuarantine('nuts.tsv', meta.name)

  let read = 0
  for await (const row of streamValidatedTsv(
    tsvPath('nuts.tsv'),
    NUTS_COLS,
    quarantine
  )) {
    read++
    const code = row.nuts_code
    if (!code) continue

    const level = code.length - 1 // "UK"=1, "UKG"=2, "UKG3"=3, "UKG34"=4
    const parentCode = code.length > 2 ? code.slice(0, -1) : null

    await batcher.add({
      code,
      name: row.nuts_region,
      level,
      parentCode,
      ricardoNutsId: toInt(row.nuts_id)
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    { read, written: batcher.written, malformed: quarantine.written },
    'nutsRegions loader complete'
  )
  return { count: batcher.written, malformed: quarantine.written }
}
