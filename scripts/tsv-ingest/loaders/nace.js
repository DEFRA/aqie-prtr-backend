/**
 * Loader: nace.tsv → naceCodes collection
 *
 * ~215 NACE Rev 2 documents with a 4-level hierarchy.
 *
 * Two-pass loader:
 *   Pass 1 — build an id→code lookup map
 *   Pass 2 — emit each doc with parent_id / grandparent_id resolved to codes
 *
 * Without the resolution step, hierarchy walks at query time would have to
 * join twice through Ricardo's integer ids — not useful in a document store.
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'

const NACE_COLS = 9
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

export const meta = {
  name: 'naceCodes',
  phase: 'reference',
  order: 13,
  sourceTsvs: ['nace.tsv'],
  targetCollection: 'nace_codes'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'code')
  const quarantine = createQuarantine('nace.tsv', meta.name)

  const rows = await readAllValidatedRows(
    tsvPath('nace.tsv'),
    NACE_COLS,
    quarantine
  )
  log.info({ rows: rows.length }, 'nace.tsv loaded')

  // Pass 1: build id → code map for hierarchy resolution
  const idToCode = new Map()
  for (const row of rows) {
    idToCode.set(toInt(row.nace_id), row.nace_code)
  }

  // Pass 2: emit docs with resolved parent codes. nace.tsv has duplicate
  // codes in source (e.g. "11.00", "12.00", "36.00" appear more than once
  // with different ricardo ids). On each duplicate we quarantine the row
  // currently sitting under that code (the one about to be overwritten),
  // then write the new row. Final row per code stays in the collection.
  // (Quarantine instance was created above so readAllValidatedRows could use it.)
  const lastRowByCode = new Map() // code → last-seen row (for quarantining when overwritten)
  let unresolvedParents = 0
  let duplicateCode = 0
  let nullCode = 0

  for (const row of rows) {
    const code = row.nace_code
    if (!code) {
      nullCode++
      await quarantine.add({
        row,
        reason: 'nace_code is NULL — cannot be _id',
        ricardoRowId: toInt(row.nace_id)
      })
      continue
    }
    if (lastRowByCode.has(code)) {
      const beingOverwritten = lastRowByCode.get(code)
      await quarantine.add({
        row: beingOverwritten,
        reason: `duplicate code "${code}" in source — this row was overwritten by a later row`,
        ricardoRowId: toInt(beingOverwritten.nace_id)
      })
      duplicateCode++
    }
    lastRowByCode.set(code, row)

    const parentId = toInt(row.parent_id)
    const grandparentId = toInt(row.grandparent_id)

    const parentCode =
      parentId && parentId !== 0 ? (idToCode.get(parentId) ?? null) : null
    const grandparentCode =
      grandparentId && grandparentId !== 0
        ? (idToCode.get(grandparentId) ?? null)
        : null

    if (
      (parentId && parentId !== 0 && !parentCode) ||
      (grandparentId && grandparentId !== 0 && !grandparentCode)
    ) {
      unresolvedParents++
    }

    await batcher.add({
      code,
      name: row.nace_name,
      prtrAnnexCode: row.prtr_annex_code,
      codeLevel: toInt(row.code_level),
      parentCode,
      grandparentCode,
      matchCount: toInt(row.matchcount),
      commentsCount: toInt(row.comments),
      ricardoNaceId: toInt(row.nace_id)
    })
  }
  await batcher.flush()
  await quarantine.flush()

  if (unresolvedParents > 0) {
    log.warn(
      { unresolvedParents },
      'some parent/grandparent ids did not resolve — check data quality'
    )
  }
  if (duplicateCode > 0) {
    log.warn(
      { duplicateCode },
      'duplicate nace_codes in source — earlier rows quarantined, last-seen wins _id'
    )
  }
  if (nullCode > 0) {
    log.warn({ nullCode }, 'rows with NULL nace_code quarantined')
  }
  log.info(
    {
      written: batcher.written,
      duplicateCode,
      nullCode,
      quarantined: quarantine.written
    },
    'naceCodes loader complete'
  )
  return {
    count: batcher.written,
    unresolvedParents,
    duplicateCode,
    nullCode,
    quarantined: quarantine.written
  }
}
