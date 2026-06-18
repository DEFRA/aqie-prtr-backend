/**
 * Loader confidential.tsv → confidentialReasons collection
 * Note: confidential_lookup.tsv is a duplicate
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const CONFIDENTIAL_COLS = 4

export const meta = {
  name: 'confidentialReasons',
  phase: 'reference',
  order: 21,
  sourceTsvs: ['confidential.tsv'],
  targetCollection: 'confidential_reasons'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'code')
  const quarantine = createQuarantine('confidential.tsv', meta.name)

  for (const row of await readAllValidatedRows(
    tsvPath('confidential.tsv'),
    CONFIDENTIAL_COLS,
    quarantine
  )) {
    if (!row.code) continue
    await batcher.add({
      code: row.code,
      name: row.name,
      description: row.description,
      ricardoConfidentialId: toInt(row.confidential_id)
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    { written: batcher.written, malformed: quarantine.written },
    'confidentialReasons loader complete'
  )
  return { count: batcher.written, malformed: quarantine.written }
}
