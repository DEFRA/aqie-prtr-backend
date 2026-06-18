/**
 * Loader pollutant.tsv + category.tsv + pollutant_information.tsv → pollutants
 *
 * pollutantInformation is merged INTO pollutants
 * (no separate collection). Each pollutant doc has: code, name, category info,
 * cas_no, isActive, plus the rich text fields (whatIsIt, affectsHumanHealth, etc.)
 * when available in pollutant_information.tsv.
 *
 * _id = Ricardo source pollutant_id (int).
 *
 * Source-PK keying (not pollutant_code) because:
 *   - pollutant_id is guaranteed present in source (it's their PK)
 *   - pollutant_code is NULL for ~16 rows that Ricardo added but didn't finish.
 *     Keying by code would lose them. Keying by id keeps them as stubs with
 *     code: null, visible to data-quality follow-up.
 *   - All other TSVs reference pollutant_id, so joins stay simple.
 */

import {
  readAllValidatedRows,
  toInt,
  toBool,
  toDate
} from '../lib/tsv-reader.js'
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

const COLS = { POLLUTANT: 6, CATEGORY: 3, POLLUTANT_INFORMATION: 11 }

export const meta = {
  name: 'pollutants',
  phase: 'reference',
  order: 12,
  sourceTsvs: ['pollutant.tsv', 'category.tsv', 'pollutant_information.tsv'],
  targetCollection: 'pollutants'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, '_id')

  const q = {
    pollutant: createQuarantine('pollutant.tsv', meta.name),
    category: createQuarantine('category.tsv', meta.name),
    pollutantInformation: createQuarantine(
      'pollutant_information.tsv',
      meta.name
    )
  }

  // Lookup: category_code → { description, versionDate }
  const categories = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('category.tsv'),
    COLS.CATEGORY,
    q.category
  )) {
    categories.set(row.category_code, {
      description: row.description,
      versionDate: toDate(row.version_date)
    })
  }
  log.info({ categories: categories.size }, 'category.tsv loaded')

  // Lookup: pollutant_id (Ricardo int) → rich-text info
  const info = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('pollutant_information.tsv'),
    COLS.POLLUTANT_INFORMATION,
    q.pollutantInformation
  )) {
    const alsoKnownAs = [row.aka1, row.aka2].filter((s) => s && s.trim() !== '')
    info.set(toInt(row.pollutant_id), {
      alsoKnownAs,
      whatIsIt: row.what_is_it,
      whatIsItUsedFor: row.what_is_it_used_for,
      whereDoesItComeFrom: row.where_does_it_come_from,
      affectsTheEnvironment: row.affect_the_environment,
      affectsHumanHealth: row.affect_human_health,
      stepsToLimitImpacts: row.steps_to_limit_impacts
    })
  }
  log.info({ withRichText: info.size }, 'pollutant_information.tsv loaded')

  let withRichText = 0
  let stubsWithoutCode = 0
  for (const row of await readAllValidatedRows(
    tsvPath('pollutant.tsv'),
    COLS.POLLUTANT,
    q.pollutant
  )) {
    const id = toInt(row.pollutant_id)
    if (id === null) {
      // Source PK violation — shouldn't happen, but defend explicitly.
      log.warn({ row }, 'pollutant.tsv row has NULL pollutant_id — skipping')
      continue
    }
    const cat = categories.get(row.category_code)
    const rich = info.get(id) ?? {}
    if (info.has(id)) {
      withRichText++
    }
    if (!row.pollutant_code) {
      stubsWithoutCode++
    }

    await batcher.add({
      _id: id,
      code: row.pollutant_code, // may be NULL
      name: row.pollutant_name,
      categoryCode: row.category_code,
      categoryDescription: cat?.description ?? null,
      categoryVersionDate: cat?.versionDate ?? null,
      casNumber: row.cas_no,
      isActive: toBool(row.is_active),
      alsoKnownAs: rich.alsoKnownAs ?? [],
      whatIsIt: rich.whatIsIt ?? null,
      whatIsItUsedFor: rich.whatIsItUsedFor ?? null,
      whereDoesItComeFrom: rich.whereDoesItComeFrom ?? null,
      affectsTheEnvironment: rich.affectsTheEnvironment ?? null,
      affectsHumanHealth: rich.affectsHumanHealth ?? null,
      stepsToLimitImpacts: rich.stepsToLimitImpacts ?? null
    })
  }
  await batcher.flush()

  for (const inst of Object.values(q)) await inst.flush()
  const malformedByFile = Object.fromEntries(
    Object.entries(q)
      .map(([k, inst]) => [k, inst.written])
      .filter(([, n]) => n > 0)
  )
  const totalMalformed = Object.values(q).reduce(
    (s, inst) => s + inst.written,
    0
  )

  if (stubsWithoutCode > 0) {
    log.warn(
      { stubsWithoutCode },
      'pollutants ingested with NULL code'
    )
  }
  log.info(
    {
      written: batcher.written,
      withRichText,
      stubsWithoutCode,
      malformedByFile,
      totalMalformed
    },
    'pollutants loader complete'
  )
  return {
    count: batcher.written,
    withRichText,
    stubsWithoutCode,
    malformedByFile,
    totalMalformed
  }
}
