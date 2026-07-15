/**
 * Loader agency.tsv → agencies collection
 * `acronym` is the document _id.
 *
 * Handles previous-identity transitions by collapsing
 * the previous_acronym / previous_name / previous_until_year columns into
 * a `previousIdentities[]` array.
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const AGENCY_COLS = 10

export const meta = {
  name: 'agencies',
  phase: 'reference',
  order: 10,
  sourceTsvs: ['agency.tsv'],
  targetCollection: 'agencies'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'acronym')
  const quarantine = createQuarantine('agency.tsv', meta.name)

  const rows = await readAllValidatedRows(
    tsvPath('agency.tsv'),
    AGENCY_COLS,
    quarantine
  )
  log.info({ rows: rows.length }, 'agency.tsv loaded')

  for (const row of rows) {
    const previousIdentities = []
    if (row.previous_acronym || row.previous_name) {
      previousIdentities.push({
        acronym: row.previous_acronym,
        name: row.previous_name,
        untilYear: toInt(row.previous_until_year)
      })
    }

    await batcher.add({
      acronym: row.acronym,
      name: row.name,
      submissionMethod: row.submissionMethod,
      email: row.email,
      contactPersonName: row.contactPersonName,
      previousIdentities,
      ricardoId: toInt(row.id)
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    { written: batcher.written, malformed: quarantine.written },
    'agencies loader complete'
  )
  return { count: batcher.written, malformed: quarantine.written }
}
