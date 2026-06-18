/**
* Quarantine helper.
*
* Writes records that the loader couldn't process to the
* `ingest_failed_records` collection so they can be inspected later.
*
* Public-data note: PRTR source data is non-confidential by regulatory
* mandate (it IS the public register), so persisting raw TSV row snapshots
* here does not introduce a PII risk.
*
* Usage:
* const q = createQuarantine('facility_record.tsv', 'facilityReports')
* await q.add({ row, reason: 'NULL facility_id', ricardoRowId: row.id })
* await q.flush()
*/

import { config } from '../config.js'
import { createLogger } from './logger.js'
import { db } from './mongo.js'

const COLLECTION = 'ingest_failed_records'

export function createQuarantine(sourceTsvFile, loaderName) {
const logger = createLogger().child({ loader: loaderName, quarantine: true })
const collection = db().collection(COLLECTION)
let buffer = []
let written = 0

async function flushBuffer() {
if (buffer.length === 0) return
if (config.dryRun) {
written += buffer.length
buffer = []
return
}
try {
await collection.insertMany(buffer, { ordered: false })
written += buffer.length
buffer = []
} catch (err) {
// BulkWriteError from { ordered: false } reports how many inserts
// succeeded. Don't silently drop the discrepancy.
const inserted = err?.result?.nInserted ?? err?.insertedCount ?? 0
const rejected = buffer.length - inserted
written += inserted
buffer = []
logger.error(
{ err, sourceTsvFile, inserted, rejected },
'quarantine insert partially failed'
)
throw err
}
}

return {
/** Capture one failed record. Flushes automatically when batch is full. */
async add({ row, reason, ricardoRowId, facilityCode, reportingYear }) {
// Capture the source TSV line number before stripping parser-internal fields.
// Lets a reviewer open the .tsv in an editor and jump straight to the offending row.
const sourceTsvLineNumber = row.__lineNumber ?? null
const cleanRow = { ...row }
delete cleanRow.__lineNumber
delete cleanRow.__columnCount
delete cleanRow.__year

buffer.push({
sourceTsvFile,
sourceTsvLineNumber,
loader: loaderName,
ricardoRowId: ricardoRowId ?? sourceTsvLineNumber ?? null,
facilityCode: facilityCode ?? null,
reportingYear: reportingYear ?? null,
failureReason: reason,
rawRow: cleanRow,
attemptedAt: new Date(),
resolved: false,
resolutionNote: null
})
if (buffer.length >= config.batchSize) await flushBuffer()
},

async flush() {
await flushBuffer()
},

get written() {
return written
}
}
}
