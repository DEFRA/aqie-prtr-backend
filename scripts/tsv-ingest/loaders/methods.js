/**
 * Loader: method.tsv → methods collection
 *
 * Methodology codes used to determine emissions/transfers (M_ISO, M_PER, C_PEN etc.).
 * _id = method_code.
 */

import { readAllValidatedRows, toInt, toBool } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const METHOD_COLS = 7

export const meta = {
  name: 'methods',
  phase: 'reference',
  order: 19,
  sourceTsvs: ['method.tsv'],
  targetCollection: 'methods'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'methodTypeCode')
  const quarantine = createQuarantine('method.tsv', meta.name)

  for (const row of await readAllValidatedRows(
    tsvPath('method.tsv'),
    METHOD_COLS,
    quarantine
  )) {
    if (!row.method_code) continue
    await batcher.add({
      methodTypeCode: row.method_code,
      methodBasisCode: row.method_type, // "Measured" / "Calculated" / "Estimated"
      methodTypeName: row.method_fullname,
      methodDescription: row.method_desc,
      isReleaseMethod: toBool(row.is_release_method),
      isTransferMethod: toBool(row.is_transfer_method),
      ricardoMethodId: toInt(row.method_id)
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    { written: batcher.written, malformed: quarantine.written },
    'methods loader complete'
  )
  return { count: batcher.written, malformed: quarantine.written }
}
