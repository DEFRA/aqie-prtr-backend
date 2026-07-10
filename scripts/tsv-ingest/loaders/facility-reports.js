/**
 * Loader : facility_record.tsv + release_transfer.tsv + many supporting TSVs
 *              → facilityReports collection
 *
 * Each facilityReports doc represents one (facility × year)
 * snapshot, with embedded arrays for releases, transfers, waste, activities,
 * and the per-year competent-authority contact.
 *
 * Bucketing rule for release_transfer.tsv:
 *   type_id 1 → pollutantReleases[] mediumCode AIR
 *   type_id 2 → pollutantReleases[] mediumCode WATER
 *   type_id 3 → pollutantReleases[] mediumCode LAND
 *   type_id 4 → pollutantTransfers[]
 *   type_id 5 → wasteTransfers[] wasteTypeCode NONHW
 *   type_id 6 → wasteTransfers[] wasteTypeCode HWIC
 *   type_id 7 → wasteTransfers[] wasteTypeCode HWOC
 */

import {
  readAllValidatedRows,
  streamValidatedTsv,
  toInt,
  toFloat,
  toBool,
  toDate
} from '../lib/tsv-reader.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath, config } from '../config.js'
import { db } from '../lib/mongo.js'

// Column counts per source TSV. Any row deviating is quarantined as
// "row has X columns, expected Y — likely embedded newline in source field".
const COLS = {
  FACILITY_RECORD: 22,
  RELEASE_TRANSFER: 18,
  FACILITY: 22,
  COMPETENT_AUTHORITY_PARTY: 12,
  FACILITY_RECORD_ACTIVITY: 5,
  FACILITY_ACTIVITY: 6,
  DISPOSAL_COMPANY: 8,
  DISPOSAL_SITE: 9
}

export const meta = {
  name: 'facilityReports',
  phase: 'core',
  order: 31,
  sourceTsvs: [
    'facility_record.tsv',
    'release_transfer.tsv',
    'facility_record_activity.tsv',
    'facility_activity.tsv',
    'competent_authority_party.tsv',
    'disposal_company.tsv',
    'disposal_site.tsv',
    'facility.tsv' // for previousNationalId lookup
  ],
  targetCollection: 'facility_reports'
}

const MEDIUM_BY_TYPE_ID = { 1: 'AIR', 2: 'WATER', 3: 'LAND' }
const WASTE_TYPE_BY_TYPE_ID = { 5: 'NONHW', 6: 'HWIC', 7: 'HWOC' }

function normaliseUnit(u) {
  if (!u) return null
  const s = String(u).toLowerCase().trim()
  if (s === 'kg' || s === 'kgm') return 'KGM'
  if (s === 'tonne' || s === 'tonnes' || s === 't' || s === 'tne') return 'TNE'
  return s.toUpperCase()
}

function buildQuantity(value, unit) {
  const num = toFloat(value)
  if (num === null) return null
  return { value: num, unit: normaliseUnit(unit) }
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)

  // CRITICAL: create the upsert filter index BEFORE writing. Without it,
  // every replaceOne does a full collection scan and writes slow down quadratically.
  // 25k docs took 60s without index; with index, the whole collection writes in seconds.
  await collection.createIndex(
    { internalFacilityId: 1, reportingYear: 1 },
    { unique: true }
  )
  log.info('upsert filter index created')

  // One quarantine per source TSV — same target collection (ingest_failed_records).
  // `quarantine` keeps its existing name (= facility_record-scoped) for backwards
  // compatibility with all the existing call sites in this file.
  const quarantine = createQuarantine('facility_record.tsv', meta.name)
  const q = {
    facilityRecord: quarantine, // alias
    releaseTransfer: createQuarantine('release_transfer.tsv', meta.name),
    facility: createQuarantine('facility.tsv', meta.name),
    competentAuthorityParty: createQuarantine(
      'competent_authority_party.tsv',
      meta.name
    ),
    facilityRecordActivity: createQuarantine(
      'facility_record_activity.tsv',
      meta.name
    ),
    facilityActivity: createQuarantine('facility_activity.tsv', meta.name),
    disposalCompany: createQuarantine('disposal_company.tsv', meta.name),
    disposalSite: createQuarantine('disposal_site.tsv', meta.name)
  }

  // facilityReports docs are LARGE (embedded releases/transfers/waste can have
  // dozens of items each). Use smaller batches (100, not 1000) so each
  // bulkWrite finishes within MongoDB's monitor timeout window.
  const FR_BATCH_SIZE = Math.min(100, config.batchSize)
  let buffer = []
  let written = 0
  async function flush() {
    if (buffer.length === 0) return
    if (config.dryRun) {
      written += buffer.length
      buffer = []
      return
    }
    const result = await collection.bulkWrite(buffer, { ordered: false })
    written += result.upsertedCount + result.matchedCount
    buffer = []
    if (written % 5000 === 0) log.info({ written }, 'progress')
  }

  // --- Step 1: lookups from MongoDB ---
  // facilities are keyed by facilityCode (stable across years). But facility.tsv
  // has DIFFERENT facility_id per year for the same facility_code. So we build:
  // facility_id (Ricardo, per-year) → facility_code (cross-year stable, from facility.tsv below)
  // facility_code → internalFacilityId (from facilities collection)
  // Then chain them to resolve facility_record.facility_id → internalFacilityId.
  // Resolve facility_code → internalFacilityId via BOTH the current code
  // and any historical codes (where the facility has been renamed across
  // years). After the rename-merge change in facilities.js (2026-06-25),
  // every historical code points at the same canonical facility doc.
  const internalFacilityIdByCode = new Map()
  for (const doc of await db()
    .collection('facilities')
    .find(
      {},
      {
        projection: {
          facilityCode: 1,
          internalFacilityId: 1,
          historicalNationalIds: 1
        }
      }
    )
    .toArray()) {
    internalFacilityIdByCode.set(doc.facilityCode, doc.internalFacilityId)
    for (const histCode of doc.historicalNationalIds ?? []) {
      internalFacilityIdByCode.set(histCode, doc.internalFacilityId)
    }
  }

  // pollutants are keyed by Ricardo source pollutant_id (doc._id, int) so
  // joins from release_transfer.tsv resolve via the source PK. Code may be
  // NULL for ~16 stub pollutants.
  const pollutantById = new Map()
  for (const doc of await db().collection('pollutants').find().toArray()) {
    pollutantById.set(doc._id, {
      code: doc.code,
      name: doc.name,
      categoryCode: doc.categoryCode,
      categoryDescription: doc.categoryDescription
    })
  }

  const methodById = new Map()
  for (const doc of await db().collection('methods').find().toArray()) {
    methodById.set(doc.ricardoMethodId, {
      methodTypeCode: doc.methodTypeCode,
      methodTypeName: doc.methodTypeName,
      methodBasisCode: doc.methodBasisCode
    })
  }

  const naceById = new Map()
  for (const doc of await db().collection('nace_codes').find().toArray()) {
    naceById.set(doc.ricardoNaceId, { code: doc.code, name: doc.name })
  }

  const regAuthById = new Map()
  for (const doc of await db()
    .collection('regulatory_authorities')
    .find()
    .toArray()) {
    regAuthById.set(doc.ricardoId, { code: doc.code, name: doc.name })
  }

  const agencyByRicardoId = new Map()
  for (const doc of await db().collection('agencies').find().toArray()) {
    agencyByRicardoId.set(doc.ricardoId, {
      acronym: doc.acronym,
      name: doc.name
    })
  }

  // Activities: ricardoId per taxonomy → resolved code + name
  const ippcById = new Map()
  const prtrById = new Map()
  for (const doc of await db().collection('activities').find().toArray()) {
    if (doc.taxonomy === 'ippc') {
      ippcById.set(doc.ricardoId, {
        code: doc.code,
        matchCode: doc.matchCode,
        name: doc.name,
        description: doc.description,
        categoryName: doc.categoryName
      })
    }
    if (doc.taxonomy === 'prtr') {
      prtrById.set(doc.ricardoId, {
        code: doc.code,
        matchCode: doc.matchCode,
        name: doc.name,
        description: doc.description,
        categoryName: doc.categoryName
      })
    }
  }

  const confidentialById = new Map()
  for (const doc of await db()
    .collection('confidential_reasons')
    .find()
    .toArray()) {
    confidentialById.set(doc.ricardoConfidentialId, {
      code: doc.code,
      name: doc.name,
      description: doc.description
    })
  }

  const countryById = new Map()
  for (const doc of await db().collection('countries').find().toArray()) {
    countryById.set(doc.ricardoCountryId, doc.name)
  }

  const countyById = new Map()
  for (const doc of await db().collection('counties').find().toArray()) {
    countyById.set(doc.countyId, doc.name)
  }

  log.info('lookups loaded from MongoDB')

  // --- Step 2: in-memory embed sources from TSVs ---

  // competent_authority_party — keyed by (year, code)
  const capPartyByYearCode = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('competent_authority_party.tsv'),
    COLS.COMPETENT_AUTHORITY_PARTY,
    q.competentAuthorityParty
  )) {
    const year = toInt(row.Year)
    const code = row.Name
    if (year === null || !code) continue
    capPartyByYearCode.set(`${year}|${code}`, {
      agencyId: toInt(row.agencyId),
      address: {
        streetName: row.StreetName,
        buildingNumber: row.BuildingNumber,
        cityName: row.CityName,
        postcodeCode: row.PostcodeCode
      },
      telephone: row.TelephoneCommunication,
      fax: row.FaxCommunication,
      email: row.EmailCommunication,
      contactPersonName: row.ContactPersonName
    })
  }

  // facility_record_activity: facility_record_id → array of {ippc_id, prtr_id, isMain}
  const activitiesByRecordId = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('facility_record_activity.tsv'),
    COLS.FACILITY_RECORD_ACTIVITY,
    q.facilityRecordActivity
  )) {
    const rid = toInt(row.facility_record_id)
    if (rid === null) continue
    const list = activitiesByRecordId.get(rid) ?? []
    list.push({
      ippcId: toInt(row.activity_ippc_id),
      prtrId: toInt(row.activity_prtr_id),
      isMain: toBool(row.is_main_activity)
    })
    activitiesByRecordId.set(rid, list)
  }

  // facility_activity: fallback by (facility_id, year)
  const activitiesByFacilityYear = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('facility_activity.tsv'),
    COLS.FACILITY_ACTIVITY,
    q.facilityActivity
  )) {
    const fid = toInt(row.facility_id)
    const yr = toInt(row.year)
    if (fid === null || yr === null) continue
    const key = `${fid}|${yr}`
    const list = activitiesByFacilityYear.get(key) ?? []
    list.push({
      ippcId: toInt(row.activity_ippc_id),
      prtrId: toInt(row.activity_prtr_id),
      isMain: toBool(row.is_main_activity)
    })
    activitiesByFacilityYear.set(key, list)
  }

  // disposal_company + disposal_site → keyed by their respective IDs
  const disposalCompanyById = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('disposal_company.tsv'),
    COLS.DISPOSAL_COMPANY,
    q.disposalCompany
  )) {
    const id = toInt(row.com_id)
    if (id === null) continue
    disposalCompanyById.set(id, {
      name: row.com_name,
      address: {
        streetName: row.com_street,
        cityName: row.com_town,
        postcodeCode: row.com_post_code,
        countryCode: row.com_country_id,
        countryName: countryById.get(toInt(row.com_country_id)) ?? null
      },
      matchCode: row.Match_Code
    })
  }
  const disposalSiteById = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('disposal_site.tsv'),
    COLS.DISPOSAL_SITE,
    q.disposalSite
  )) {
    const id = toInt(row.site_id)
    if (id === null) continue
    disposalSiteById.set(id, {
      name: row.site_name,
      address: {
        streetName: row.site_street,
        cityName: row.site_town,
        postcodeCode: row.site_post_code,
        countryCode: row.site_country_id,
        countryName: countryById.get(toInt(row.site_country_id)) ?? null
      },
      matchCode: row.Match_Code
    })
  }

  // facility.tsv lookups — keep the FULL per-year data so facilityReports can
  // carry year-specific address/location (which is what the schema spec says,
  // not "latest only on facilities" which would lose historical addresses).
  //
  // Build:
  // facilityCodeByFacilityId — facility_id (per-year) → facility_code (cross-year)
  // facilityIdByCode — latest-year code → facility_id (for release_transfer bucket lookup)
  // facilityRowByCodeYear — (code, year) → row (for per-year address/location enrichment)
  // facility.tsv has multiple rows per (facility_id, year). We build several
  // year-aware lookups so previousNationalId can be the CORRECT year's code
  // (not just the latest — that bug returned, e.g., "DESNZOffsh-Stella" as the
  // previousNationalId for a 2017 record when the right answer is "BEISOffsh-Stella").
  const facilityIdByCode = new Map() // latest-year facility_id per code
  const latestYearByCode = new Map()
  const facilityRowByCodeYear = new Map()
  // NEW: per-year code lookup so previousNationalId works correctly for renames
  const codeByFidAndYear = new Map() // "facilityId|year" → facilityCode
  const yearsByFacilityId = new Map() // facilityId → sorted desc list of years seen
  for await (const row of streamValidatedTsv(
    tsvPath('facility.tsv'),
    COLS.FACILITY,
    q.facility
  )) {
    const fid = toInt(row.facility_id)
    const code = row.facility_code
    const year = toInt(row.year) ?? 0
    if (fid !== null && code) {
      facilityRowByCodeYear.set(`${code}|${year}`, row)
      codeByFidAndYear.set(`${fid}|${year}`, code)
      if (!yearsByFacilityId.has(fid)) yearsByFacilityId.set(fid, [])
      yearsByFacilityId.get(fid).push(year)
      const prevYear = latestYearByCode.get(code) ?? -1
      if (year >= prevYear) {
        latestYearByCode.set(code, year)
        facilityIdByCode.set(code, fid)
      }
    }
  }
  // Sort each facility_id's year list descending so we can pick "most recent
  // year strictly before the current report's year" in O(years-for-this-fid).
  for (const years of yearsByFacilityId.values()) years.sort((a, b) => b - a)

  // For previousReportingYear — build facility_id → max-reported-year from
  // facility_record.tsv. Used to resolve old_facility_id → the prior facility's
  // last reporting year. One-pass pre-scan.
  //
  // AND: while we're here, decide which facility_record row wins per
  // (internalFacilityId, year) when there's a rename-overlap duplicate.
  //   Prefer is_partial=0 over is_partial=1 (Ricardo's own completeness flag).
  //   Cross-checked against Ricardo's XML for 69 pairs:
  //     52 first-seen picks match XML  (would win via either rule)
  //     9 first-seen picks are WRONG   (is_partial rule flips them correctly)
  //     8 not in XML at all            (no difference)
  //   So the is_partial=0 rule matches Ricardo's canonical XML entries.
  const maxReportingYearByFacilityId = new Map()
  const preferredRecordIdByKey = new Map() // "internalFacilityId|year" → facility_record.id
  const preferredRowIsPartialByKey = new Map()
  for await (const row of streamValidatedTsv(
    tsvPath('facility_record.tsv'),
    COLS.FACILITY_RECORD,
    q.facilityRecord
  )) {
    const fid = toInt(row.facility_id)
    const yr = toInt(row.year)
    if (fid !== null && yr !== null) {
      const prev = maxReportingYearByFacilityId.get(fid) ?? -1
      if (yr > prev) maxReportingYearByFacilityId.set(fid, yr)
    }
    // Preferred-row election: track the winner per (internalFacilityId, year).
    // Both codes for a renamed facility resolve to the same internalFacilityId
    // (facility.tsv historicalNationalIds), so this is where we detect the overlap.
    const code = row.code
    const id = toInt(row.id)
    if (!code || yr === null || id === null) continue
    const internalFacilityId = internalFacilityIdByCode.get(code)
    if (!internalFacilityId) continue
    const isPartial = toBool(row.is_partial)
    const key = `${internalFacilityId}|${yr}`
    const currentWinner = preferredRecordIdByKey.get(key)
    if (currentWinner === undefined) {
      preferredRecordIdByKey.set(key, id)
      preferredRowIsPartialByKey.set(key, isPartial)
    } else {
      const currentIsPartial = preferredRowIsPartialByKey.get(key)
      // Flip to this row ONLY if current is partial and this one is not.
      if (currentIsPartial === true && isPartial === false) {
        preferredRecordIdByKey.set(key, id)
        preferredRowIsPartialByKey.set(key, isPartial)
      }
    }
  }
  log.info(
    {
      capParties: capPartyByYearCode.size,
      activitiesByRecord: activitiesByRecordId.size,
      activitiesByFacilityYear: activitiesByFacilityYear.size,
      disposalCompanies: disposalCompanyById.size,
      disposalSites: disposalSiteById.size
    },
    'embed-source TSVs loaded into memory'
  )

  // --- Step 3: bucket release_transfer.tsv by (facility_id, year) ---
  // Each bucket has releases[], transfers[], waste[]
  const buckets = new Map()
  const consumedBucketKeys = new Set()
  let releaseTransferRows = 0
  let unknownTypes = 0
  for await (const row of streamValidatedTsv(
    tsvPath('release_transfer.tsv'),
    COLS.RELEASE_TRANSFER,
    q.releaseTransfer
  )) {
    releaseTransferRows++
    const fid = toInt(row.facility_id)
    const yr = toInt(row.year)
    const typeId = toInt(row.type_id)
    if (fid === null || yr === null || typeId === null) continue

    const key = `${fid}|${yr}`
    if (!buckets.has(key)) {
      buckets.set(key, { releases: [], transfers: [], waste: [] })
    }
    const bucket = buckets.get(key)

    const pollutant = pollutantById.get(toInt(row.pollutant_id))
    const method = methodById.get(toInt(row.method_id))
    const confidential = confidentialById.get(toInt(row.confidential_id))
    const quantity = buildQuantity(row.value, row.units)

    const baseEntry = {
      pollutantId: toInt(row.pollutant_id), // stable FK; always present in source
      pollutantCode: pollutant?.code ?? null, // denormalised — NULL for stub pollutants
      pollutantName: pollutant?.name ?? null,
      pollutantCategoryCode: pollutant?.categoryCode ?? null,
      methodTypeCode: method?.methodTypeCode ?? null,
      methodTypeName: method?.methodTypeName ?? null,
      methodBasisCode: method?.methodBasisCode ?? null,
      methodDesignation: null, // XML-only, null for TSV per CLAUDE_CODE_GUIDANCE.md
      confidentialIndicator: confidential != null,
      confidentialityReasonCode: confidential?.code ?? null,
      ricardoReleaseTransferId: toInt(row.release_transfer_id),
      sourceCreatedAt: toDate(row.created_on)
    }

    if (MEDIUM_BY_TYPE_ID[typeId]) {
      bucket.releases.push({
        ...baseEntry,
        mediumCode: MEDIUM_BY_TYPE_ID[typeId],
        totalQuantity: quantity,
        accidentalQuantity: buildQuantity(row.release_accidental, row.units)
      })
    } else if (typeId === 4) {
      bucket.transfers.push({
        ...baseEntry,
        totalQuantity: quantity
      })
    } else if (WASTE_TYPE_BY_TYPE_ID[typeId]) {
      const comId = toInt(row.transfer_com_id)
      const siteId = toInt(row.transfer_site_id)
      const company = comId ? (disposalCompanyById.get(comId) ?? null) : null
      const site = siteId ? (disposalSiteById.get(siteId) ?? null) : null
      bucket.waste.push({
        ...baseEntry,
        wasteTypeCode: WASTE_TYPE_BY_TYPE_ID[typeId],
        wasteTreatmentCode: row.treatment_type || null,
        quantity,
        wasteHandlerParty:
          company || site
            ? {
              name: company?.name ?? site?.name ?? null,
              address: company?.address ?? null,
              siteAddress: site?.address ?? null,
              matchCode: company?.matchCode ?? site?.matchCode ?? null,
              ricardoCompanyId: comId,
              ricardoSiteId: siteId
            }
            : null
      })
    } else {
      unknownTypes++
    }
  }
  log.info(
    {
      releaseTransferRows,
      bucketCount: buckets.size,
      unknownTypes
    },
    'release_transfer.tsv bucketed by (facility_id, year)'
  )

  // --- Step 4: stream facility_record.tsv and build docs ---
  // The validated helper sends rows whose column count != header width to
  // q.facilityRecord automatically (almost always caused by an embedded `\n`
  // in a text field). We never reconstruct
  // split rows with heuristics.
  let recordsRead = 0
  let missingFacility = 0
  let skippedNoIdOrYear = 0
  let duplicateFacilityYear = 0
  // Track (internalFacilityId, reportingYear) pairs seen so we can quarantine
  // duplicates rather than have one silently overwrite the other.
  const seenFacilityYear = new Set()
  for await (const row of streamValidatedTsv(
    tsvPath('facility_record.tsv'),
    COLS.FACILITY_RECORD,
    q.facilityRecord
  )) {
    recordsRead++
    const fid = toInt(row.facility_id)
    const year = toInt(row.year)
    const recordId = toInt(row.id)
    if (fid === null || year === null) {
      skippedNoIdOrYear++
      await quarantine.add({
        row,
        reason: 'NULL facility_id or year — cannot match to facility',
        ricardoRowId: recordId,
        facilityCode: row.code,
        reportingYear: year
      })
      continue
    }

    // facility_record.code is the per-year-reported nationalId — this is what
    // facilities are keyed by in our collection. NOT facility.tsv.facility_id
    // which is a SEPARATE id-space (facility.tsv is incomplete).
    const facilityCode = row.code
    const internalFacilityId = facilityCode
      ? internalFacilityIdByCode.get(facilityCode)
      : null
    if (!internalFacilityId) {
      missingFacility++
      await quarantine.add({
        row,
        reason:
          'facility_record.code does not match any facility in facilities collection',
        ricardoRowId: recordId,
        facilityCode,
        reportingYear: year
      })
      continue
    }
    const facility = { internalFacilityId, facilityCode }

    const nace = naceById.get(toInt(row.nace_id))
    const confidentialReason = confidentialById.get(toInt(row.confidential_id))

    // Build activities: prefer facility_record_activity; fall back to facility_activity by (fid, year)
    const rawActivities =
      activitiesByRecordId.get(recordId) ??
      activitiesByFacilityYear.get(`${fid}|${year}`) ??
      []
    const activities = []
    let ranking = 1
    for (const a of rawActivities) {
      if (a.ippcId !== null) {
        const def = ippcById.get(a.ippcId)
        if (def) {
          activities.push({
            activityCode: def.matchCode,
            name: def.name,
            description: def.description,
            categoryName: def.categoryName,
            taxonomy: 'ippc',
            isMainActivity: a.isMain,
            ranking: ranking++
          })
        }
      }
      if (a.prtrId !== null) {
        const def = prtrById.get(a.prtrId)
        if (def) {
          activities.push({
            activityCode: def.matchCode,
            name: def.name,
            description: def.description,
            categoryName: def.categoryName,
            taxonomy: 'prtr',
            isMainActivity: a.isMain,
            ranking: ranking++
          })
        }
      }
    }

    // Competent authority — look up authority by Ricardo authority_id; contact from cap_party (year, code)
    const regAuth = regAuthById.get(toInt(row.authority_id))
    const capContact = regAuth
      ? capPartyByYearCode.get(`${year}|${regAuth.code}`)
      : null
    const agency =
      capContact?.agencyId !== undefined
        ? agencyByRicardoId.get(capContact.agencyId)
        : null

    // previousNationalId / previousReportingYear from old_facility_id.
    //
    // old_facility_id points at facility.tsv.facility_id (Ricardo's metadata
    // table — verified 2026-06-22: 99.8% of old_facility_id values match
    // facility.tsv.facility_id). We need the code AT the year RIGHT BEFORE
    // this report's year — not the latest year, which would return the
    // facility's CURRENT name even when it was already current at the time of
    // this report (the original bug).
    //
    // Algorithm: look up the most recent year strictly before `year` for the
    // referenced facility_id; that year's code is the previousNationalId.
    // Only set the field if the resolved code DIFFERS from the current row's
    // code (matches XML <PreviousNationalID> semantics, which appears only
    // when the national ID actually changed).
    const oldFid = toInt(row.old_facility_id)
    let previousNationalId = null
    let previousReportingYear = null
    if (oldFid !== null && oldFid !== 0) {
      const candidates = yearsByFacilityId.get(oldFid) ?? []
      for (const y of candidates) {
        if (y < year) {
          const codeAtY = codeByFidAndYear.get(`${oldFid}|${y}`)
          if (codeAtY && codeAtY !== row.code) {
            previousNationalId = codeAtY
            previousReportingYear = y
          }
          break
        }
      }
    }

    // Year-specific address + location from facility.tsv (NOT facility_record).
    // facility.tsv has one row per (code, year); pick this specific year's row.
    const facilityTsvRow = facilityRowByCodeYear.get(`${facilityCode}|${year}`)
    let yearSpecificAddress = null
    let yearSpecificLocation = null
    if (facilityTsvRow) {
      yearSpecificAddress = {
        streetName: facilityTsvRow.street,
        cityName: facilityTsvRow.town,
        postcode: facilityTsvRow.postcode,
        countyName:
          countyById.get(toInt(facilityTsvRow.county_id)) ??
          facilityTsvRow.county ??
          null,
        countryName: facilityTsvRow.country || null
      }
      const lng = toFloat(facilityTsvRow.longitude)
      const lat = toFloat(facilityTsvRow.latitude)
      if (
        lng !== null &&
        lat !== null &&
        Math.abs(lng) <= 180 &&
        Math.abs(lat) <= 90
      ) {
        yearSpecificLocation = { type: 'Point', coordinates: [lng, lat] }
      }
    }

    // release_transfer.tsv uses facility.tsv's facility_id space, NOT
    // facility_record's. Translate via facilityIdByCode.
    const facilityTsvFid = facilityIdByCode.get(row.code)
    const bucketKey = facilityTsvFid !== undefined ? `${facilityTsvFid}|${year}` : null
    const bucket =
      bucketKey !== null
        ? (buckets.get(bucketKey) ?? {
          releases: [],
          transfers: [],
          waste: []
        })
        : { releases: [], transfers: [], waste: [] }
    //Mark consumed regardless of whether the bucket existed - any subsequent
    //duplicate facility_record row for the same (facility, year) is detected
    //and quarantined below, so the bucket's data is already represented here.

    if (bucketKey !== null)
      consumedBucketKeys.add(bucketKey)

    const doc = {
      internalFacilityId: facility.internalFacilityId,
      reportingYear: year,
      nationalId: row.code ?? facility.facilityCode,
      ricardoFacilityRecordId: recordId,
      isPartialRicardo: toBool(row.is_partial),
      previousNationalId,
      previousReportingYear,
      facilityName: row.name,
      parentCompanyName: row.parent_organisation,
      naceCode: nace?.code ?? null,
      mainEconomicActivityName: nace?.name ?? null,
      competentAuthority: {
        regulatoryAuthority: regAuth
          ? { code: regAuth.code, name: regAuth.name }
          : { code: null, name: null },
        agency: agency
          ? { acronym: agency.acronym, name: agency.name }
          : { acronym: null, name: null },
        contact: capContact
          ? {
            address: capContact.address,
            telephone: capContact.telephone,
            fax: capContact.fax,
            email: capContact.email,
            contactPersonName: capContact.contactPersonName
          }
          : null
      },
      address: yearSpecificAddress,
      location: yearSpecificLocation,
      activities,
      pollutantReleases: bucket.releases,
      pollutantTransfers: bucket.transfers,
      wasteTransfers: bucket.waste,
      totalIppcInstallationQty: toInt(row.total_ippc_installation_quantity),
      totalEmployeeQty: toInt(row.total_employee_quantity),
      operationHours: toInt(row.operation_hours),
      websiteUrl: row.website_communication,
      publicInformation: row.public_information,
      remarkText: row.comments,
      protectVoluntaryData: toBool(row.protect_voluntary_data),
      confidentialIndicator: confidentialReason != null,
      confidentialityReasonCode: confidentialReason?.code ?? null,
      contactTelephone: row.telephone,
      dataSource: 'ricardo-tsv',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    // Detect duplicate (internalFacilityId, reportingYear) within source —
    // the second-seen row would silently replace the first via upsert.
    // Use the pre-scan's is_partial=0 election to decide the winner rather
    // than "first-seen". Non-winning rows are quarantined for traceability.
    const facYearKey = `${facility.internalFacilityId}|${year}`
    const preferredId = preferredRecordIdByKey.get(facYearKey)
    if (preferredId !== undefined && preferredId !== recordId) {
      duplicateFacilityYear++
      const preferredIsPartial = preferredRowIsPartialByKey.get(facYearKey)
      await quarantine.add({
        row,
        reason: `duplicate (facility_code "${facilityCode}", year ${year}) — another row for the same facility (via historicalNationalIds) already elected as canonical (preferred facility_record.id=${preferredId}, is_partial=${preferredIsPartial}); this row is_partial=${toBool(row.is_partial)}`,
        ricardoRowId: recordId,
        facilityCode,
        reportingYear: year
      })
      continue
    }
    if (seenFacilityYear.has(facYearKey)) {
      // Shouldn't happen if pre-scan election is correct, but guard anyway.
      duplicateFacilityYear++
      await quarantine.add({
        row,
        reason: `duplicate (facility_code "${facilityCode}", year ${year}) — same-code row already processed; this would have replaced it`,
        ricardoRowId: recordId,
        facilityCode,
        reportingYear: year
      })
      continue
    }
    seenFacilityYear.add(facYearKey)


    buffer.push({
      replaceOne: {
        filter: {
          internalFacilityId: facility.internalFacilityId,
          reportingYear: year
        },
        replacement: doc,
        upsert: true
      }
    })
    if (buffer.length >= FR_BATCH_SIZE) await flush()
  }
  await flush()

  // --- Step 5: leftover-bucket sweep ---
  //
  // Some (facility.tsv-fid, year) buckets have release_transfer / waste data
  // but no corresponding facility_record.tsv row to attach them to. Without
  // this sweep they are silently dropped — verified production gap, e.g.
  // London Two (facility_id=1060320, year=2024, 2.04t waste, treatment=Recovery).
  //
  // Strategy: for each unconsumed bucket, build a synthetic facility_reports
  // doc from facility.tsv metadata (year-specific) + the bucket. Tag with
  // dataSource='synthesised-from-emissions' so consumers can distinguish
  // these from formal Ricardo facility_record-backed reports.
  //
  // Identity resolution: bucket key is (tsv_fid, year). Get the per-year
  // code from facility.tsv via codeByFidAndYear; fall back to the latest
  // year ≤ this year for that fid. Then code → internalFacilityId via the
  // facilities collection (covers historical/rename codes too).
  let leftoverWritten = 0
  let leftoverSkippedNoFacility = 0
  let leftoverSkippedAlreadyWritten = 0
  for (const [bucketKey, bucket] of buckets) {
    if (consumedBucketKeys.has(bucketKey)) continue
    const sepIdx = bucketKey.indexOf('|')
    const tsvFid = Number(bucketKey.slice(0, sepIdx))
    const year = Number(bucketKey.slice(sepIdx + 1))

    let code = codeByFidAndYear.get(`${tsvFid}|${year}`)
    if (!code) {
      const candidates = yearsByFacilityId.get(tsvFid) ?? []
      for (const y of candidates) {
        if (y <= year) {
          code = codeByFidAndYear.get(`${tsvFid}|${y}`)
          if (code) break
        }
      }
    }
    const internalFacilityId = code
      ? internalFacilityIdByCode.get(code)
      : null
    if (!internalFacilityId) {
      // Per-row quarantine: iterate every release/transfer/waste entry in the
      // orphan bucket and log each as its own record under release_transfer.tsv.
      // This preserves pollutant/quantity/method detail so Ricardo can act on
      // each specific emission (bucket-level records lost that granularity).
      const orphanEntries = [
        ...bucket.releases.map((e) => ({
          ...e,
          kind: 'release',
          mediumCode: e.mediumCode ?? null,
          quantity: e.totalQuantity ?? null,
          accidentalQuantity: e.accidentalQuantity ?? null,
          wasteTypeCode: null,
          wasteTreatmentCode: null
        })),
        ...bucket.transfers.map((e) => ({
          ...e,
          kind: 'transfer',
          mediumCode: null,
          quantity: e.totalQuantity ?? null,
          accidentalQuantity: null,
          wasteTypeCode: null,
          wasteTreatmentCode: null
        })),
        ...bucket.waste.map((e) => ({
          ...e,
          kind: 'waste',
          mediumCode: null,
          quantity: e.quantity ?? null,
          accidentalQuantity: null,
          wasteTypeCode: e.wasteTypeCode ?? null,
          wasteTreatmentCode: e.wasteTreatmentCode ?? null
        }))
      ]
      leftoverSkippedNoFacility += orphanEntries.length
      for (const entry of orphanEntries) {
        await q.releaseTransfer.add({
          row: {
            facility_id: tsvFid,
            year,
            resolvedCode: code ?? null,
            kind: entry.kind,
            pollutantId: entry.pollutantId,
            pollutantCode: entry.pollutantCode,
            pollutantName: entry.pollutantName,
            mediumCode: entry.mediumCode,
            wasteTypeCode: entry.wasteTypeCode,
            wasteTreatmentCode: entry.wasteTreatmentCode,
            quantity: entry.quantity,
            accidentalQuantity: entry.accidentalQuantity,
            methodTypeCode: entry.methodTypeCode ?? null,
            confidentialityReasonCode: entry.confidentialityReasonCode ?? null,
            ricardoCreatedAt: entry.sourceCreatedAt ?? null
          },
          reason:
            'leftover-sweep: release_transfer row belongs to a (facility_id, year) that has no facility_record row AND no facility.tsv entry resolves to a facility doc',
          ricardoRowId: entry.ricardoReleaseTransferId ?? null,
          facilityCode: code ?? null,
          reportingYear: year
        })
      }
      continue
    }

    // Year-specific row from facility.tsv (may be undefined if the bucket's
    // year is outside facility.tsv's coverage; then we fall back to nulls).
    const facilityTsvRow = code
      ? facilityRowByCodeYear.get(`${code}|${year}`)
      : null

    let yearSpecificAddress = null
    let yearSpecificLocation = null
    if (facilityTsvRow) {
      yearSpecificAddress = {
        streetName: facilityTsvRow.street,
        cityName: facilityTsvRow.town,
        postcode: facilityTsvRow.postcode,
        countyName:
          countyById.get(toInt(facilityTsvRow.county_id)) ??
          facilityTsvRow.county ??
          null,
        countryName: facilityTsvRow.country || null
      }
      const lng = toFloat(facilityTsvRow.longitude)
      const lat = toFloat(facilityTsvRow.latitude)
      if (
        lng !== null &&
        lat !== null &&
        Math.abs(lng) <= 180 &&
        Math.abs(lat) <= 90
      ) {
        yearSpecificLocation = { type: 'Point', coordinates: [lng, lat] }
      }
    }

    const rawActivities = activitiesByFacilityYear.get(`${tsvFid}|${year}`) ?? []
    const activities = []
    let ranking = 1
    for (const a of rawActivities) {
      if (a.ippcId !== null) {
        const def = ippcById.get(a.ippcId)
        if (def) {
          activities.push({
            activityCode: def.matchCode,
            name: def.name,
            description: def.description,
            categoryName: def.categoryName,
            taxonomy: 'ippc',
            isMainActivity: a.isMain,
            ranking: ranking++
          })
        }
      }
      if (a.prtrId !== null) {
        const def = prtrById.get(a.prtrId)
        if (def) {
          activities.push({
            activityCode: def.matchCode,
            name: def.name,
            description: def.description,
            categoryName: def.categoryName,
            taxonomy: 'prtr',
            isMainActivity: a.isMain,
            ranking: ranking++
          })
        }
      }
    }

    const regAuth = facilityTsvRow
      ? regAuthById.get(toInt(facilityTsvRow.authority_id))
      : null
    const capContact = regAuth
      ? capPartyByYearCode.get(`${year}|${regAuth.code}`)
      : null
    const agency =
      capContact?.agencyId !== undefined
        ? agencyByRicardoId.get(capContact.agencyId)
        : null
    const nace = facilityTsvRow
      ? naceById.get(toInt(facilityTsvRow.nace_id))
      : null

    // Collision check: a leftover bucket can resolve to an internalFacilityId
    // that the main pass already wrote a doc for (rare — happens when a
    // facility_record row's code-bridge resolves to a different facility.tsv
    // fid than the bucket's). Skip rather than overwrite.
    const facYearKey = `${internalFacilityId}|${year}`
    if (seenFacilityYear.has(facYearKey)) {
      leftoverSkippedAlreadyWritten++
      continue
    }
    seenFacilityYear.add(facYearKey)

    const doc = {
      internalFacilityId,
      reportingYear: year,
      nationalId: code,
      ricardoFacilityRecordId: null,
      isPartialRicardo: true,
      previousNationalId: null,
      previousReportingYear: null,
      facilityName: facilityTsvRow?.facility_name ?? null,
      parentCompanyName: facilityTsvRow?.parent_organisation ?? null,
      naceCode: nace?.code ?? null,
      mainEconomicActivityName: nace?.name ?? null,
      competentAuthority: {
        regulatoryAuthority: regAuth
          ? { code: regAuth.code, name: regAuth.name }
          : { code: null, name: null },
        agency: agency
          ? { acronym: agency.acronym, name: agency.name }
          : { acronym: null, name: null },
        contact: capContact
          ? {
            address: capContact.address,
            telephone: capContact.telephone,
            fax: capContact.fax,
            email: capContact.email,
            contactPersonName: capContact.contactPersonName
          }
          : null
      },
      address: yearSpecificAddress,
      location: yearSpecificLocation,
      activities,
      pollutantReleases: bucket.releases,
      pollutantTransfers: bucket.transfers,
      wasteTransfers: bucket.waste,
      totalIppcInstallationQty: null,
      totalEmployeeQty: null,
      operationHours: null,
      websiteUrl: null,
      publicInformation: null,
      remarkText: null,
      protectVoluntaryData: null,
      confidentialIndicator: false,
      confidentialityReasonCode: null,
      contactTelephone: facilityTsvRow?.telephone ?? null,
      dataSource: 'synthesised-from-emissions',
      createdAt: new Date(),
      updatedAt: new Date()
    }

    buffer.push({
      replaceOne: {
        filter: { internalFacilityId, reportingYear: year },
        replacement: doc,
        upsert: true
      }
    })
    leftoverWritten++
    if (buffer.length >= FR_BATCH_SIZE) await flush()
  }
  await flush()

  // Flush every quarantine and collect per-file malformed counts.
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

  log.info(
    {
      recordsRead,
      written,
      missingFacility,
      skippedNoIdOrYear,
      duplicateFacilityYear,
      malformedByFile,
      totalMalformed,
      bucketsConsumed: buckets.size,
      bucketsConsumed: consumedBucketKeys.size,
      leftoverWritten,
      leftoverSkippedNoFacility,
      leftoverSkippedAlreadyWritten
    },
    'facilityReports loader complete'
  )
  return {
    count: written,
    missingFacility,
    skippedNoIdOrYear,
    duplicateFacilityYear,
    malformedByFile,
    totalMalformed,
    leftoverWritten,
    leftoverSkippedNoFacility,
    leftoverSkippedAlreadyWritten
  }
}
