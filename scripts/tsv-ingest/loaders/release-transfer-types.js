/**
 * Loader: release_transfer_type.tsv → releaseTransferTypes collection
 *
 * 7 type_ids drive the bucketing rule in 31-facility-reports.js:
 *   1, 2, 3 → pollutantReleases (AIR / WATER / LAND)
 *   4       → pollutantTransfers
 *   5, 6, 7 → wasteTransfers (NONHW / HWIC / HWOC)
 *
 * _id = typeId.
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const RT_TYPE_COLS = 5

export const meta = {
  name: 'releaseTransferTypes',
  phase: 'reference',
  order: 20,
  sourceTsvs: ['release_transfer_type.tsv'],
  targetCollection: 'release_transfer_types'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'typeId')
  const quarantine = createQuarantine('release_transfer_type.tsv', meta.name)

  for (const row of await readAllValidatedRows(
    tsvPath('release_transfer_type.tsv'),
    RT_TYPE_COLS,
    quarantine
  )) {
    const id = toInt(row.type_id)
    if (id === null) continue
    await batcher.add({
      typeId: id,
      typeName: row.type_name,
      typeField: row.type_field,
      typeCategory: row.type_category // RELEASE or TRANSFER
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    { written: batcher.written, malformed: quarantine.written },
    'releaseTransferTypes loader complete'
  )
  return { count: batcher.written, malformed: quarantine.written }
}
