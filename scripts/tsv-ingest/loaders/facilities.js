/**
 * Loader facility.tsv (+ many supporting TSVs) → facilities collection
 *
 * Each facility document embeds parentCompany, permits[],
 * inspireMapping, and euProductionHierarchy.
 *
 * Steps:
 *   1. Build all denormalisation lookups from MongoDB collections that
 *      previous loaders already populated (agencies, regulatoryAuthorities,
 *      naceCodes, nutsRegions, riverBasinDistricts, counties).
 *   2. Build per-facility embed sources from TSVs into in-memory maps
 *      (facility_inspire_map, facility_parents_company, facility_permit,
 *      production_facility, production_installation, eSPIRS_ETS_Identifier).
 *   3. Load postcode_location into memory (loader may have already run;
 *      this loader re-uses its exported map).
 *   4. Stream facility.tsv, group by facility_code, take the latest-year row
 *      per facility (facility.tsv has multiple rows per site — one per year).
 *   5. For each unique facility: mint internalFacilityId UUID, build doc,
 *      backfill coords from postcode map if NULL in source, upsert.
 *
 * Precomputed fields (mainPrtrActivity, latestReportingYear, etc.) are NOT
 * populated here — see facility-latest-summary.js.
 */

import { createHash } from 'node:crypto'
/**
 * Mint  Deterministic internal facilityId from facilityId.
 * facilitily Id is stable this will give a determisnistic UUID with a SHA-256 code truncated to 32 chars in every env
 * on every re-run
 */
function deterministicFacilityId(facilityId) {
  if (facilityId === null || facilityId === undefined || facilityId === '') {
    throw new Error('deterministicFacilityId: facilityId is required')
  }
  return `f-${createHash('sha256').update(String(facilityId)).digest('hex').slice(0, 32)}`
}

import {
  readAllValidatedRows,
  streamValidatedTsv,
  toInt,
  toFloat
} from '../lib/tsv-reader.js'
import { createQuarantine } from '../lib/quarantine.js'
import { loaderLogger } from '../lib/logger.js'
import { tsvPath, config } from '../config.js'
import { db } from '../lib/mongo.js'
import { run as loadPostcodeMap, lookupPostcode } from './postcode-map.js'

// Column counts per source TSV (header width). Any row deviating from these
// is quarantined — almost always caused by embedded `\n` in a text field.
const COLS = {
  FACILITY: 22,
  FACILITY_INSPIRE_MAP: 5,
  FACILITY_PARENTS_COMPANY: 4,
  FACILITY_PERMIT: 7,
  PRODUCTION_FACILITY: 5,
  PRODUCTION_INSTALLATION: 5,
  ESPIRS_ETS: 4,
  COMPETENT_AUTHORITY_PARTY: 12,
  FACILITY_RECORD: 22
}

export const meta = {
  name: 'facilities',
  phase: 'core',
  order: 30,
  sourceTsvs: [
    'facility.tsv',
    'facility_parents_company.tsv',
    'facility_permit.tsv',
    'facility_inspire_map.tsv',
    'production_facility.tsv',
    'production_installation.tsv',
    'eSPIRS_ETS_Identifier.tsv',
    'competent_authority_party.tsv',
    'postcode_location.tsv'
  ],
  targetCollection: 'facilities'
}

export async function run() {
  const log = loaderLogger(meta.name)
  const collection = db().collection(meta.targetCollection)

  // CRITICAL: create the upsert filter index BEFORE writing. Without it,
  // every updateOne does a full collection scan and writes slow down quadratically.
  await collection.createIndex({ facilityCode: 1 }, { unique: true })
  log.info('upsert filter index created')

  // One quarantine instance per source TSV so each row's sourceTsvFile is
  // accurate. They all write to the shared `ingest_failed_records` collection.
  const q = {
    facility: createQuarantine('facility.tsv', meta.name),
    facilityInspireMap: createQuarantine('facility_inspire_map.tsv', meta.name),
    facilityParentsCompany: createQuarantine(
      'facility_parents_company.tsv',
      meta.name
    ),
    facilityPermit: createQuarantine('facility_permit.tsv', meta.name),
    productionFacility: createQuarantine('production_facility.tsv', meta.name),
    productionInstallation: createQuarantine(
      'production_installation.tsv',
      meta.name
    ),
    espirsEts: createQuarantine('eSPIRS_ETS_Identifier.tsv', meta.name),
    competentAuthorityParty: createQuarantine(
      'competent_authority_party.tsv',
      meta.name
    ),
    facilityRecord: createQuarantine('facility_record.tsv', meta.name)
  }

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
  }

  async function upsertFacility(facilityCode, setOnInsertDoc, setDoc) {
    buffer.push({
      updateOne: {
        filter: { facilityCode },
        update: {
          $setOnInsert: setOnInsertDoc,
          $set: setDoc
        },
        upsert: true
      }
    })
    if (buffer.length >= config.batchSize) await flush()
  }

  // --- Step 1: denormalisation lookups from MongoDB ---
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
  const riverBasinById = new Map()
  for (const doc of await db()
    .collection('river_basin_districts')
    .find()
    .toArray()) {
    riverBasinById.set(doc.ricardoRiverBasinId, {
      code: doc.code,
      name: doc.name
    })
  }
  const countyById = new Map()
  for (const doc of await db().collection('counties').find().toArray()) {
    countyById.set(doc.countyId, doc.name)
  }
  const nutsByCode = new Map()
  for (const doc of await db().collection('nuts_regions').find().toArray()) {
    nutsByCode.set(doc.code, doc.name)
  }
  const agencyByRicardoId = new Map()
  for (const doc of await db().collection('agencies').find().toArray()) {
    agencyByRicardoId.set(doc.ricardoId, {
      acronym: doc.acronym,
      name: doc.name
    })
  }
  log.info(
    {
      nace: naceById.size,
      regulatoryAuthorities: regAuthById.size,
      riverBasins: riverBasinById.size,
      counties: countyById.size,
      nuts: nutsByCode.size,
      agencies: agencyByRicardoId.size
    },
    'denormalisation lookups loaded from MongoDB'
  )

  // --- Step 2: per-facility embed sources from TSVs ---

  // facility_inspire_map: facility_code → eu_registry_local_id + inspire mapping
  const inspireByCode = new Map()
  const euRegistryToFacilityCode = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('facility_inspire_map.tsv'),
    COLS.FACILITY_INSPIRE_MAP,
    q.facilityInspireMap
  )) {
    if (!row.facility_code) continue
    const euLocalId = row.eu_registry_local_id
    inspireByCode.set(row.facility_code, {
      euRegistryLocalId: euLocalId,
      namespace: row.namespace,
      inspireId: row.inspire_id
    })
    if (euLocalId) euRegistryToFacilityCode.set(euLocalId, row.facility_code)
  }

  // facility_parents_company: keyed by ProductionFacility_locaIId (note TSV typo "locaI")
  const parentCompanyByEuId = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('facility_parents_company.tsv'),
    COLS.FACILITY_PARENTS_COMPANY,
    q.facilityParentsCompany
  )) {
    const euId = row.ProductionFacility_locaIId
    if (!euId) continue
    parentCompanyByEuId.set(euId, {
      name: row.parentCompanyName,
      url: row.parentCompanyURL,
      confidentialityReasonCode: row.confidentail_reason || null
    })
  }

  // facility_permit: facility_id (int) → array of permits
  const permitsByFacilityId = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('facility_permit.tsv'),
    COLS.FACILITY_PERMIT,
    q.facilityPermit
  )) {
    const fid = toInt(row.facility_id)
    if (fid === null) continue
    const list = permitsByFacilityId.get(fid) ?? []
    list.push({
      authorisationId: row.authorisation_id,
      authorisationType: row.authorisation_type,
      startDate: row.start_date,
      expiryDate: row.expiry_date,
      supersededBy: row.superseded_by,
      ricardoPermitId: toInt(row.id)
    })
    permitsByFacilityId.set(fid, list)
  }

  // production_facility: keyed by ProductionFacility_locaIId
  const prodFacilityByEuId = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('production_facility.tsv'),
    COLS.PRODUCTION_FACILITY,
    q.productionFacility
  )) {
    if (!row.ProductionFacility_locaIId) continue
    prodFacilityByEuId.set(row.ProductionFacility_locaIId, {
      thematicId: row.ProductionFacility_thematicId,
      statusType: row.statusType,
      productionSiteLocalId: row.ProductionSite_localId
    })
  }

  // production_installation: keyed by facility_locaIId → installation local id
  const prodInstallationByEuId = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('production_installation.tsv'),
    COLS.PRODUCTION_INSTALLATION,
    q.productionInstallation
  )) {
    const facilityEuId = row.facility_locaIId
    if (!facilityEuId) continue
    prodInstallationByEuId.set(facilityEuId, {
      productionInstallationLocalId: row.ProductionInstallation_localId,
      thematicId: row.thematicId,
      statusType: row.statusType
    })
  }

  // eSPIRS_ETS: keyed by ProductionInstallation_localId
  const etsByInstallationId = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('eSPIRS_ETS_Identifier.tsv'),
    COLS.ESPIRS_ETS,
    q.espirsEts
  )) {
    if (!row.ProductionInstallation_localId) continue
    etsByInstallationId.set(row.ProductionInstallation_localId, {
      eSPIRSIdentifier: row.eSPIRSIdentifier || null,
      etsIdentifier: row.ETSIdentifier || null
    })
  }

  // competent_authority_party: build (authority code → latest agencyId)
  // for "latest known" agency on each facility
  const latestAgencyIdByAuthCode = new Map()
  const latestYearByAuthCode = new Map()
  for (const row of await readAllValidatedRows(
    tsvPath('competent_authority_party.tsv'),
    COLS.COMPETENT_AUTHORITY_PARTY,
    q.competentAuthorityParty
  )) {
    const code = row.Name
    const year = toInt(row.Year)
    const agencyId = toInt(row.agencyId)
    if (!code || year === null) continue
    const prevYear = latestYearByAuthCode.get(code)
    if (prevYear === undefined || year > prevYear) {
      latestYearByAuthCode.set(code, year)
      latestAgencyIdByAuthCode.set(code, agencyId)
    }
  }

  log.info(
    {
      inspireMappings: inspireByCode.size,
      parentCompanies: parentCompanyByEuId.size,
      facilitiesWithPermits: permitsByFacilityId.size,
      productionFacilities: prodFacilityByEuId.size,
      productionInstallations: prodInstallationByEuId.size,
      etsIdentifiers: etsByInstallationId.size,
      authoritiesWithAgency: latestAgencyIdByAuthCode.size
    },
    'embed-source TSVs loaded into memory'
  )

  // --- Step 3: postcode map ---
  await loadPostcodeMap()

  // --- Step 4: read facility.tsv, group by facility_id
  //Per Ricardo's 2026-06-22 clarification: facility_id is the stable
  // identity of a physical facility; facility_code (national_id) can change
  // when regulators rename (DECC → BEIS → DESNZ, EA → NRW transfers).
  //
  // So one physical facility = one facility_id = ONE facility doc.
  // The latest year's code becomes the doc's `facilityCode` (current name);
  // all other codes ever seen for that facility_id become
  // `historicalNationalIds[]`. See DATA_QUALITY_NOTES.md and
  // SCHEMA_REVIEW_2026_06_08.md §3c for the architect decision context.
  //
  // Structure: Map<facility_id, { latestRow, allCodes: Set, latestYear }>
  const groupByFacilityId = new Map()
  let rowsRead = 0
  for await (const row of streamValidatedTsv(
    tsvPath('facility.tsv'),
    COLS.FACILITY,
    q.facility
  )) {
    rowsRead++
    const code = row.facility_code
    const facId = toInt(row.facility_id)
    if (!code || facId === null) continue
    const year = toInt(row.year) ?? 0
    row.__year = year

    let group = groupByFacilityId.get(facId)
    if (!group) {
      group = { latestRow: row, allCodes: new Set(), latestYear: year }
      groupByFacilityId.set(facId, group)
    } else if (year >= group.latestYear) {
      group.latestRow = row
      group.latestYear = year
    }
    group.allCodes.add(code)
  }

  // Quick lookup: which facility_id does each known code belong to?
  const codeToFacilityId = new Map()
  for (const [facId, group] of groupByFacilityId) {
    for (const code of group.allCodes) {
      codeToFacilityId.set(code, facId)
    }
  }

  log.info(
    { rowsRead, uniqueFacilities: groupByFacilityId.size },
    'facility.tsv grouped by facility_id (stable identity, per Ricardo 2026-06-22)'
  )

  // Step 4b: For codes in facility_record.tsv but not yet in any group, try to
  // resolve via the old_facility_id bridge (which references facility.tsv's
  // facility_id 99.8% of the time per audit). If resolved, add the code to the
  // parent's group as a historical name. If not, it's a TRUE ORPHAN — quarantine.
  const codeFirstRecordRow = new Map() // code → first-seen facility_record row
  const oldFidsByCode = new Map() // code → Set<old_facility_id values across all years>
  for await (const row of streamValidatedTsv(
    tsvPath('facility_record.tsv'),
    COLS.FACILITY_RECORD,
    q.facilityRecord
  )) {
    const code = row.code
    if (!code) continue
    if (!codeFirstRecordRow.has(code)) codeFirstRecordRow.set(code, row)
    const oldFid = toInt(row.old_facility_id)
    if (oldFid !== null && oldFid !== 0) {
      if (!oldFidsByCode.has(code)) oldFidsByCode.set(code, new Set())
      oldFidsByCode.get(code).add(oldFid)
    }
  }

  let chainResolved = 0
  let trueOrphans = 0
  const codeAlreadyQuarantined = new Set()
  for (const [code, row] of codeFirstRecordRow) {
    if (codeToFacilityId.has(code)) continue // already in a group

    let resolvedFacId = null
    const candidates = oldFidsByCode.get(code) ?? new Set()
    for (const oldFid of candidates) {
      if (groupByFacilityId.has(oldFid)) {
        resolvedFacId = oldFid
        break
      }
    }

    if (resolvedFacId !== null) {
      // RENAMED facility — add this code to the parent's historical-codes set
      groupByFacilityId.get(resolvedFacId).allCodes.add(code)
      codeToFacilityId.set(code, resolvedFacId)
      chainResolved++
      continue
    }

    // True orphan — quarantine
    if (codeAlreadyQuarantined.has(code)) continue
    codeAlreadyQuarantined.add(code)
    trueOrphans++
    await q.facilityRecord.add({
      row,
      reason:
        'facility_code in facility_record.tsv has no corresponding facility.tsv entry (neither directly nor via old_facility_id chain) — true orphan, no metadata available',
      ricardoRowId: toInt(row.id) ?? row.__lineNumber,
      facilityCode: code,
      reportingYear: toInt(row.year)
    })
  }
  log.info(
    {
      chainResolved,
      trueOrphans,
      totalFacilities: groupByFacilityId.size
    },
    'facility_record codes resolved into existing groups via old_facility_id (or quarantined as true orphans)'
  )

  // --- Step 5: build and upsert docs ---
  // One doc per group (= one doc per physical facility = one doc per facility_id).
  // The latest year's row becomes the canonical metadata; all other codes the
  // facility has been known by become historicalNationalIds[].
  let backfilled = 0
  let validGeo = 0
  for (const [groupFacId, group] of groupByFacilityId) {
    const row = group.latestRow
    // Pre-compute the historical-codes array (everything except the current
    // code from this row). Visible to the upsert below via closure.
    const historicalNationalIds = [...group.allCodes].filter(
      (c) => c !== row.facility_code
    )
    row.__groupFacilityId = groupFacId
    row.__historicalNationalIds = historicalNationalIds
    // Fall through to the original per-row build logic below; nothing else
    // changes inside this loop.
    const facilityCode = row.facility_code
    const ricardoFacilityId = toInt(row.facility_id)

    // Resolve denorms
    const nace = naceById.get(toInt(row.nace_id))
    const regAuth = regAuthById.get(toInt(row.authority_id))
    const riverBasin = riverBasinById.get(toInt(row.river_basin))
    const countyName = countyById.get(toInt(row.county_id)) ?? null
    const nutsCode = row.nuts
    const nutsName = nutsCode ? (nutsByCode.get(nutsCode) ?? null) : null

    // Determine agency for "latest known": look up via authority code in cap_party
    const agencyId = regAuth ? latestAgencyIdByAuthCode.get(regAuth.code) : null
    const agency =
      agencyId !== null && agencyId !== undefined
        ? agencyByRicardoId.get(agencyId)
        : null

    // Resolve INSPIRE mapping and EU production hierarchy
    const inspire = inspireByCode.get(facilityCode) ?? null
    const euLocalId = inspire?.euRegistryLocalId ?? null
    const parentCompany = euLocalId
      ? (parentCompanyByEuId.get(euLocalId) ?? null)
      : null
    const prodFacility = euLocalId
      ? (prodFacilityByEuId.get(euLocalId) ?? null)
      : null
    const prodInstallation = euLocalId
      ? (prodInstallationByEuId.get(euLocalId) ?? null)
      : null
    const ets = prodInstallation?.productionInstallationLocalId
      ? (etsByInstallationId.get(
        prodInstallation.productionInstallationLocalId
      ) ?? null)
      : null

    // Coords — backfill from postcode map if NULL in source
    let lng = toFloat(row.longitude)
    let lat = toFloat(row.latitude)
    let easting = toInt(row.easting)
    let northing = toInt(row.northing)
    if (lng === null || lat === null) {
      const lookup = lookupPostcode(row.postcode)
      if (lookup) {
        if (lng === null) lng = lookup.longitude
        if (lat === null) lat = lookup.latitude
        if (easting === null) easting = lookup.easting
        if (northing === null) northing = lookup.northing
        backfilled++
      }
    }

    const hasValidGeo =
      lng !== null &&
      lat !== null &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 90
    if (hasValidGeo) validGeo++

    // Separate fields that should ONLY be set on first insert from those
    // refreshed on every run. internalFacilityId is DETERMINISTIC via
    // SHA-256 of the stable facility_id — survives rename events
    // (DECC → BEIS → DESNZ, EA → NRW).
    const setOnInsertDoc = {
      internalFacilityId: deterministicFacilityId(row.__groupFacilityId),
      facilityCode,
      createdAt: new Date()
    }
    const setDoc = {
      ricardoFacilityId,
      // All historical national IDs this facility has been known by
      // (excluding the current facilityCode). Populated when a facility has
      // been renamed across years
      historicalNationalIds: row.__historicalNationalIds,
      facilityName: row.facility_name,
      parentCompany: parentCompany ?? {
        name: row.parent_organisation ?? null,
        url: null,
        confidentialityReasonCode: null
      },
      naceCode: nace?.code ?? null,
      mainEconomicActivityName: nace?.name ?? null,
      competentAuthority: {
        regulatoryAuthority: regAuth
          ? { code: regAuth.code, name: regAuth.name }
          : { code: null, name: null },
        agency: agency
          ? { acronym: agency.acronym, name: agency.name }
          : { acronym: null, name: null }
      },
      address: {
        streetName: row.street,
        cityName: row.town,
        postcode: row.postcode,
        countyName,
        countryName: row.country || null
      },
      nutsRegionId: nutsCode,
      nutsRegionName: nutsName,
      riverBasinDistrictCode: riverBasin?.code ?? null,
      riverBasinDistrictName: riverBasin?.name ?? null,
      easting,
      northing,
      location: hasValidGeo ? { type: 'Point', coordinates: [lng, lat] } : null,
      contactTelephone: row.telephone,
      confidentialityReasonCode: null, // resolved later if confidentialIndicator=true
      // Embedded sub-objects
      permits:
        ricardoFacilityId !== null
          ? (permitsByFacilityId.get(ricardoFacilityId) ?? [])
          : [],
      inspireMapping: inspire,
      euProductionHierarchy:
        euLocalId || ets
          ? {
            productionFacilityLocalId: euLocalId,
            productionSiteLocalId:
              prodFacility?.productionSiteLocalId ?? null,
            productionInstallationLocalId:
              prodInstallation?.productionInstallationLocalId ?? null,
            namespace: inspire?.namespace ?? null,
            thematicId:
              prodFacility?.thematicId ??
              prodInstallation?.thematicId ??
              null,
            statusType:
              prodFacility?.statusType ??
              prodInstallation?.statusType ??
              null,
            eSPIRSIdentifier: ets?.eSPIRSIdentifier ?? null,
            etsIdentifier: ets?.etsIdentifier ?? null
          }
          : null,
      // dataSource — provenance per CLAUDE_CODE_GUIDANCE.md
      dataSource: 'ricardo-tsv',
      updatedAt: new Date()
    }
    await upsertFacility(facilityCode, setOnInsertDoc, setDoc)
  }
  await flush()

  // Flush every quarantine and collect malformed-row counts.
  for (const inst of Object.values(q)) await inst.flush()
  const quarantineByFile = Object.fromEntries(
    Object.entries(q)
      .map(([k, inst]) => [k, inst.written])
      .filter(([, n]) => n > 0)
  )
  const totalQuarantined = Object.values(q).reduce(
    (s, inst) => s + inst.written,
    0
  )

  log.info(
    {
      written,
      backfilledCoords: backfilled,
      validGeo,
      malformedByFile: quarantineByFile,
      totalMalformed: totalQuarantined
    },
    'facilities loader complete'
  )
  return {
    count: written,
    backfilled,
    validGeo,
    malformedByFile: quarantineByFile,
    totalMalformed: totalQuarantined
  }
}
