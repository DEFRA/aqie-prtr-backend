/**
 * Loader activity_ippc.tsv + activity_prtr.tsv + activity_category.tsv → activities
 *
 * IPPC and PRTR are MERGED into one collection
 * with a `taxonomy` discriminator field. Composite _id keeps the keyspaces
 * separate:
 *   ippc:1.2  → IPPC activity with code 1.2
 *   prtr:1a   → PRTR activity with matchCode 1a
 *
 * Each activity carries `categoryName` denormalised inline (saves a lookup
 * when rendering).
 *
 * IPPC.prtr_id provides a cross-reference to its corresponding PRTR activity;
 * we store this as `linkedPrtrCode` (resolved via Ricardo's prtr id → code).
 */

import { readAllValidatedRows, toInt } from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const COLS = { ACTIVITY_CATEGORY: 2, ACTIVITY_IPPC: 7, ACTIVITY_PRTR: 7 }

export const meta = {
  name: 'activities',
  phase: 'reference',
  order: 15,
  sourceTsvs: [
    'activity_category.tsv',
    'activity_ippc.tsv',
    'activity_prtr.tsv'
  ],
  targetCollection: 'activities'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, '_id')

  const q = {
    activityCategory: createQuarantine('activity_category.tsv', meta.name),
    activityIppc: createQuarantine('activity_ippc.tsv', meta.name),
    activityPrtr: createQuarantine('activity_prtr.tsv', meta.name)
  }

  // Lookup: category_id → name
  const categories = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('activity_category.tsv'),
    COLS.ACTIVITY_CATEGORY,
    q.activityCategory
  )) {
    categories.set(toInt(row.activity_category_id), row.activity_category_name)
  }

  // Read PRTR first so we can build prtr_id → matchCode lookup for IPPC.linkedPrtrCode
  const prtrRows = await readAllValidatedRows(
    tsvPath('activity_prtr.tsv'),
    COLS.ACTIVITY_PRTR,
    q.activityPrtr
  )
  const prtrIdToMatchCode = new Map()
  for (const row of prtrRows) {
    prtrIdToMatchCode.set(toInt(row.activity_id), row.activity_MatchCode)
  }

  // Build PRTR parent_activity_id → matchCode for hierarchy
  for (const row of prtrRows) {
    const categoryId = toInt(row.activity_category_id)
    const parentId = toInt(row.parent_activity_id)
    await batcher.add({
      _id: `prtr:${row.activity_MatchCode}`,
      code: row.activity_code,
      taxonomy: 'prtr',
      name: row.activity_name,
      description: row.activity_desc,
      matchCode: row.activity_MatchCode,
      parentCode:
        parentId && parentId !== 0
          ? (prtrIdToMatchCode.get(parentId) ?? null)
          : null,
      categoryId,
      categoryName: categories.get(categoryId) ?? null,
      ricardoId: toInt(row.activity_id)
    })
  }

  for (const row of await readAllValidatedRows(
    tsvPath('activity_ippc.tsv'),
    COLS.ACTIVITY_IPPC,
    q.activityIppc
  )) {
    const categoryId = toInt(row.activity_category_id)
    const prtrId = toInt(row.prtr_id)
    await batcher.add({
      _id: `ippc:${row.activity_MatchCode}`,
      code: row.activity_code,
      taxonomy: 'ippc',
      name: row.activity_name,
      description: row.activity_desc,
      matchCode: row.activity_MatchCode,
      parentCode: null,
      categoryId,
      categoryName: categories.get(categoryId) ?? null,
      linkedPrtrCode: prtrId ? (prtrIdToMatchCode.get(prtrId) ?? null) : null,
      ricardoId: toInt(row.ippc_id)
    })
  }
  await batcher.flush()

  for (const inst of Object.values(q)) await inst.flush()
  const totalMalformed = Object.values(q).reduce(
    (s, inst) => s + inst.written,
    0
  )

  log.info(
    { written: batcher.written, categories: categories.size, totalMalformed },
    'activities loader complete'
  )
  return { count: batcher.written, totalMalformed }
}
