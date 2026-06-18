/**
 * Loader: river_basin.tsv → riverBasinDistricts collection
 *
 * 16 docs. _id = river basin code (e.g. "UK09" for Severn).
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'

const RIVER_BASIN_COLS = 3
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

export const meta = {
  name: 'riverBasinDistricts',
  phase: 'reference',
  order: 16,
  sourceTsvs: ['river_basin.tsv'],
  targetCollection: 'river_basin_districts'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'code')
  const quarantine = createQuarantine('river_basin.tsv', meta.name)
  let nullCode = 0

  for (const row of await readAllValidatedRows(
    tsvPath('river_basin.tsv'),
    RIVER_BASIN_COLS,
    quarantine
  )) {
    if (!row.river_basin_code) {
      nullCode++
      await quarantine.add({
        row,
        reason: 'river_basin_code is NULL — cannot be _id',
        ricardoRowId: toInt(row.river_basin_id)
      })
      continue
    }
    await batcher.add({
      code: row.river_basin_code,
      name: row.river_basin_name,
      ricardoRiverBasinId: toInt(row.river_basin_id)
    })
  }
  await batcher.flush()
  await quarantine.flush()

  if (nullCode > 0) {
    log.warn(
      { nullCode },
      'rows with NULL river_basin_code quarantined (e.g. "Offshore" basin)'
    )
  }
  log.info(
    { written: batcher.written, nullCode, quarantined: quarantine.written },
    'riverBasinDistricts loader complete'
  )
  return { count: batcher.written, nullCode, quarantined: quarantine.written }
}
