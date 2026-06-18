/**.
* Creates every index defined in the schema specification on the relevant
* collections. Idempotent — running it multiple times is safe (MongoDB
* silently no-ops if the index already exists).
*
* Usage:
* node scripts/tsv-ingest/create-indexes.js
* MONGO_URI=... node scripts/tsv-ingest/create-indexes.js
*
* Run this AFTER the migration completes (or any time — indexes can be added
* later without re-loading data).
*/

import { connect, db, close } from './lib/mongo.js'
import { createLogger } from './lib/logger.js'

const logger = createLogger()

/**
* Index definitions per collection. Each entry is one of:
* { key, options? }
* where `key` matches MongoDB's createIndex first arg.
*/
const INDEX_PLAN = {
facilities: [
{ key: { internalFacilityId: 1 }, options: { unique: true } },
{ key: { facilityCode: 1 }, options: { unique: true } }, // also created inline by 30-facilities loader
{
key: { location: '2dsphere' },
options: {
name: 'location_2dsphere_partial',
partialFilterExpression: {
'location.coordinates.0': { $gte: -180, $lte: 180 },
'location.coordinates.1': { $gte: -90, $lte: 90 }
}
}
},
{ key: { naceCode: 1 }, options: { name: 'naceCode_idx' } },
{
key: { 'competentAuthority.regulatoryAuthority.code': 1 },
options: { name: 'regulatoryAuthority_code_idx' }
},
{
key: { 'competentAuthority.agency.acronym': 1 },
options: { name: 'agency_acronym_idx' }
},
{ key: { nutsRegionId: 1 }, options: { name: 'nutsRegionId_idx' } },
{
key: { riverBasinDistrictCode: 1 },
options: { name: 'riverBasinDistrictCode_idx' }
},
{ key: { 'address.countyName': 1 }, options: { name: 'countyName_idx' } },
{
key: { latestReportingYear: -1 },
options: { name: 'latestReportingYear_idx' }
},
{
key: { mainPrtrActivityCode: 1 },
options: { name: 'mainPrtrActivityCode_idx' }
},
{
key: { mainIppcActivityCode: 1 },
options: { name: 'mainIppcActivityCode_idx' }
},
// Free-text search across name + address + activity names. Only ONE text
// index allowed per collection; make it compound across all searchable fields.
{
key: {
facilityName: 'text',
'address.streetName': 'text',
'address.cityName': 'text',
'address.postcode': 'text',
mainPrtrActivityName: 'text',
mainIppcActivityName: 'text'
},
options: { name: 'facility_text_search' }
},
{
key: { 'permits.expiryDate': 1 },
options: { name: 'permits_expiryDate_idx' }
}
],

facility_reports: [
// Detail page lookup + ingest idempotency. NOTE: this is created at ingest
// time by facility-reports.js — listed here for completeness.
{
key: { internalFacilityId: 1, reportingYear: 1 },
options: { unique: true }
}, // also created inline by facility-reports loader
{
key: { reportingYear: 1, nationalId: 1 },
options: { unique: true, name: 'year_nationalId_unique' }
},
// Phase 2 pollutant search — multikey indexes on the embedded arrays.
// Required for "facilities that released CO2", "top emitters of NH3", etc.
// Both pollutantId (stable FK, always present) and pollutantCode
// (denormalised, may be NULL for stub pollutants) are indexed because
// different consumers join on each.
{
key: { 'pollutantReleases.pollutantId': 1 },
options: { name: 'releases_pollutantId_multikey' }
},
{
key: { 'pollutantTransfers.pollutantId': 1 },
options: { name: 'transfers_pollutantId_multikey' }
},
{
key: { 'pollutantReleases.pollutantCode': 1 },
options: { name: 'releases_pollutantCode_multikey' }
},
{
key: { 'pollutantTransfers.pollutantCode': 1 },
options: { name: 'transfers_pollutantCode_multikey' }
},
{
key: { 'wasteTransfers.wasteTypeCode': 1 },
options: { name: 'waste_typeCode_multikey' }
},
{
key: { 'pollutantReleases.mediumCode': 1 },
options: { name: 'releases_mediumCode_multikey' }
},
// Compound: "all 2024 facilities that released CO2". MongoDB allows
// compound index with at most one array field, so this works.
{
key: { reportingYear: 1, 'pollutantReleases.pollutantCode': 1 },
options: { name: 'year_pollutantCode_compound' }
},
// Historical regulator queries: "all 2018 facilities regulated by E68"
{
key: {
'competentAuthority.regulatoryAuthority.code': 1,
reportingYear: 1
},
options: { name: 'regAuth_year_compound' }
},
{
key: { 'activities.activityCode': 1, 'activities.taxonomy': 1 },
options: { name: 'activities_code_taxonomy_multikey' }
},
{ key: { dataSource: 1 }, options: { name: 'dataSource_idx' } },
{
key: { previousNationalId: 1, previousReportingYear: 1 },
options: { name: 'previousNationalId_compound' }
}
],

agencies: [
{ key: { acronym: 1 }, options: { unique: true, name: 'acronym_unique' } }
],

regulatory_authorities: [
{ key: { code: 1 }, options: { unique: true, name: 'code_unique' } },
{ key: { location: '2dsphere' }, options: { name: 'location_2dsphere' } }
],

pollutants: [
// _id is the Ricardo source pollutant_id (int). The EU PRTR code is a
// denormalised field — unique where present, NULL for ~16 stubs in source.
// Partial unique index allows multiple NULL codes without breaking the
// uniqueness invariant for the codes that ARE set.
{
key: { code: 1 },
options: {
unique: true,
name: 'code_unique',
partialFilterExpression: { code: { $type: 'string' } }
}
},
{ key: { categoryCode: 1 }, options: { name: 'categoryCode_idx' } },
// Free-text search across pollutant identity + rich content
{
key: { name: 'text', alsoKnownAs: 'text', whatIsIt: 'text' },
options: { name: 'pollutant_text_search' }
}
],

nace_codes: [
{ key: { code: 1 }, options: { unique: true, name: 'code_unique' } },
{ key: { parentCode: 1 }, options: { name: 'parentCode_idx' } },
{ key: { codeLevel: 1 }, options: { name: 'codeLevel_idx' } }
],

nuts_regions: [
{ key: { code: 1 }, options: { unique: true, name: 'code_unique' } },
{ key: { parentCode: 1 }, options: { name: 'parentCode_idx' } }
],

activities: [
// Note: `code` is NOT unique within a taxonomy (PRTR activities reuse "a",
// "b" etc. under different parents). Uniqueness is on `matchCode` (e.g.
// "1a", "2a") which includes parent context.
{
key: { taxonomy: 1, matchCode: 1 },
options: { unique: true, name: 'taxonomy_matchCode_unique' }
},
{ key: { taxonomy: 1, code: 1 }, options: { name: 'taxonomy_code_idx' } },
{ key: { categoryId: 1 }, options: { name: 'categoryId_idx' } }
],

river_basin_districts: [
{ key: { code: 1 }, options: { unique: true, name: 'code_unique' } }
],

counties: [
{ key: { countyId: 1 }, options: { unique: true, name: 'countyId_unique' } }
],

countries: [
{
key: { ricardoCountryId: 1 },
options: { unique: true, name: 'ricardoCountryId_unique' }
}
],

methods: [
{
key: { methodTypeCode: 1 },
options: { unique: true, name: 'methodTypeCode_unique' }
}
],

release_transfer_types: [
{ key: { typeId: 1 }, options: { unique: true, name: 'typeId_unique' } }
],

confidential_reasons: [
{ key: { code: 1 }, options: { unique: true, name: 'code_unique' } }
],

methodology_notes: [
{ key: { effectiveYear: -1 }, options: { name: 'effectiveYear_idx' } },
{
key: { 'affects.naceCodes': 1 },
options: { name: 'affects_naceCodes_multikey' }
},
{
key: { 'affects.pollutantCodes': 1 },
options: { name: 'affects_pollutantCodes_multikey' }
}
],

reports: [
{
key: { reportingYear: -1 },
options: { unique: true, name: 'reportingYear_unique' }
},
{
key: { isLive: 1, downloadXmlAvailable: 1 },
options: { name: 'live_available_compound' }
}
],

ingest_runs: [
{ key: { startedAt: -1 }, options: { name: 'startedAt_desc' } },
{ key: { status: 1 }, options: { name: 'status_idx' } }
],

ingest_failed_records: [
// Not unique — the same row can fail for different reasons across retries
// and ricardoRowId is sometimes null (no usable id in source).
{
key: { sourceTsvFile: 1, ricardoRowId: 1 },
options: { name: 'source_row_idx' }
},
{ key: { loader: 1 }, options: { name: 'loader_idx' } },
{ key: { resolved: 1 }, options: { name: 'resolved_idx' } }
]
}

async function main() {
await connect()
let totalCreated = 0
let totalSkippedExisting = 0
let totalErrors = 0

for (const [collectionName, indexes] of Object.entries(INDEX_PLAN)) {
const collection = db().collection(collectionName)
logger.info(
{ collection: collectionName, indexCount: indexes.length },
'creating indexes'
)

// Pre-fetch existing indexes once per collection so we can detect
// "already exists with different name" without re-querying. If the
// collection doesn't exist yet (e.g. ingestRuns when no ingest has run),
// treat as empty; createIndex implicitly creates the collection.
const existingByKey = new Map()
try {
for (const idx of await collection.listIndexes().toArray()) {
existingByKey.set(JSON.stringify(idx.key), idx.name)
}
} catch (err) {
if (
err.codeName !== 'NamespaceNotFound' &&
!/ns does not exist/.test(err.message)
) {
throw err
}
// Collection doesn't exist — empty set of existing indexes, no error.
}

for (const { key, options } of indexes) {
const keyStr = JSON.stringify(key)
if (existingByKey.has(keyStr)) {
totalSkippedExisting++
logger.debug(
{
collection: collectionName,
key,
existingName: existingByKey.get(keyStr)
},
'index already exists; skipping'
)
continue
}
try {
const name = await collection.createIndex(key, options ?? {})
existingByKey.set(keyStr, name)
totalCreated++
logger.debug(
{ collection: collectionName, index: name },
'index created'
)
} catch (err) {
totalErrors++
logger.error(
{
collection: collectionName,
key,
options,
err: err.message
},
'failed to create index'
)
}
}
}

logger.info(
{
totalCollections: Object.keys(INDEX_PLAN).length,
indexesEnsured: totalCreated + totalSkippedExisting,
errors: totalErrors
},
'index creation complete'
)

await close()
process.exit(totalErrors > 0 ? 1 : 0)
}

main().catch(async (err) => {
logger.fatal(
{ err: err.message, stack: err.stack },
'unhandled error in main()'
)
await close().catch(() => {})
process.exit(1)
})
