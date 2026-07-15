/**
 * Loader: year.tsv → reports collection
 *
 * One doc per reporting year.
 *   - No S3 paths stored (constructed at runtime from env config)
 *   - No remarkText stored ("None" hardcoded in XML template if needed)
 *   - isLive comes from year.tsv (year_is_live flag)
 *
 * Data-quality note: year.tsv has 2020 duplicated (year_id 23 AND 25). We
 * dedupe by reportingYear, keeping the row whose isLive flag is true.
 *
 * _id = reportingYear.
 */

import { readAllValidatedRows, toInt, toBool } from '../lib/tsv-reader.js'

const YEAR_COLS = 3
import { createUpsertBatcher } from '../lib/upsert.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath } from '../config.js'
import { db } from '../lib/mongo.js'

export const meta = {
  name: 'reports',
  phase: 'reference',
  order: 23,
  sourceTsvs: ['year.tsv'],
  targetCollection: 'reports'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)
  const batcher = createUpsertBatcher(collection, 'reportingYear')

  const quarantine = createQuarantine('year.tsv', meta.name)

  // Dedupe year.tsv. If the same year appears twice, prefer isLive=true and
  // quarantine the loser for traceability.
  const byYear = new Map()
  let duplicates = 0
  let nullYear = 0
  for (const row of await readAllValidatedRows(
    tsvPath('year.tsv'),
    YEAR_COLS,
    quarantine
  )) {
    const year = toInt(row.year)
    if (year === null) {
      nullYear++
      await quarantine.add({
        row,
        reason: 'year is NULL',
        ricardoRowId: toInt(row.year_id)
      })
      continue
    }
    const isLive = toBool(row.year_is_live)
    if (byYear.has(year)) {
      duplicates++
      const existing = byYear.get(year)
      // Loser gets quarantined; winner stays in byYear map
      if (!existing.isLive && isLive) {
        await quarantine.add({
          row: existing.row,
          reason: `duplicate year ${year} — superseded by a row with isLive=true`,
          ricardoRowId: toInt(existing.row.year_id)
        })
        byYear.set(year, { year, isLive, row })
      } else {
        await quarantine.add({
          row,
          reason: `duplicate year ${year} — already had a row (preferred isLive=true if any)`,
          ricardoRowId: toInt(row.year_id)
        })
      }
    } else {
      byYear.set(year, { year, isLive, row })
    }
  }
  if (duplicates > 0) {
    log.warn(
      { duplicates },
      'year.tsv contained duplicate years; loser quarantined, winner kept (preferred isLive=true)'
    )
  }
  if (nullYear > 0) log.warn({ nullYear }, 'rows with NULL year quarantined')

  for (const { year, isLive } of byYear.values()) {
    await batcher.add({
      reportingYear: year,
      countryId: 'GB',
      coordinateSystemId: 'EPSG:4326',
      isLive,
      downloadXmlAvailable: false, // flip true once XMLs are uploaded to S3
      downloadXmlFileSize: null,
      downloadXmlSha256: null,
      downloadXmlPublishedAt: null,
      sourceTsvFiles: [], // populated by the actual ingest run
      sourceFingerprints: [],
      ingestRunId: null,
      recordCounts: null
    })
  }
  await batcher.flush()
  await quarantine.flush()

  log.info(
    {
      written: batcher.written,
      distinctYears: byYear.size,
      duplicates,
      nullYear,
      quarantined: quarantine.written
    },
    'reports loader complete'
  )
  return {
    count: batcher.written,
    duplicates,
    nullYear,
    quarantined: quarantine.written
  }
}
