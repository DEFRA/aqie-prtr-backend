/**
* Diagnostic — quick quarantine breakdown without mongosh.
* Usage: node scripts/tsv-ingest/diagnostic.js
*/

import { connect, db, close } from './lib/mongo.js'

async function main() {
  await connect()
  const coll = db().collection('ingest_failed_records')

  const total = await coll.countDocuments()
  console.log(`\n=== TOTAL quarantine records: ${total} ===\n`)

  console.log('=== Breakdown by source TSV ===')
  const bySource = await coll
    .aggregate([
      { $group: { _id: '$sourceTsvFile', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])
    .toArray()
  for (const r of bySource) {
    console.log(` ${String(r.count).padStart(6)} ${r._id}`)
  }

  console.log('\n=== Top 10 failure reasons ===')
  const byReason = await coll
    .aggregate([
      { $group: { _id: { $substr: ['$failureReason', 0, 70] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ])
    .toArray()
  for (const r of byReason) {
    console.log(` ${String(r.count).padStart(6)} ${r._id}`)
  }

  console.log('\n=== Live collection counts ===')
  for (const c of [
    'facilities',
    'facility_reports',
    'pollutants',
    'agencies',
    'regulatory_authorities',
    'nace_codes',
    'river_basin_districts'
  ]) {
    const n = await db().collection(c).estimatedDocumentCount()
    console.log(` ${String(n).padStart(6)} ${c}`)
  }

  await close()
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
