/**
 * Loader: methodologyNotes collection (curated — empty seed for now)
 *
 * No TSV source. This collection is for manually authored cross-year
 * caveats (e.g. "Regulator renamed in 2023 — DECC → BEIS → DESNZ").
 *
 * Creates the collection if it doesn't exist; doesn't write any documents
 * unless someone has dropped seed JSON into data/methodology-notes.json
 * (TBD — not implemented in this loader).
 */

import { loaderLogger } from '../lib/logger.js'
import { db } from '../lib/mongo.js'

export const meta = {
  name: 'methodologyNotes',
  phase: 'reference',
  order: 22,
  sourceTsvs: [],
  targetCollection: 'methodology_notes'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const exists =
    (await db().listCollections({ name: meta.targetCollection }).toArray())
      .length > 0
  if (!exists) {
    await db().createCollection(meta.targetCollection)
    log.info(
      { collection: meta.targetCollection },
      'created empty methodologyNotes collection'
    )
  } else {
    log.info(
      { collection: meta.targetCollection },
      'methodologyNotes already exists; no seed data to write'
    )
  }
  return { count: 0 }
}
