/**
 * Additional detail of a single release / transfer / waste line.
 *
 * One service covers all five screen variants (release to air/water/soil,
 * transfer to waste water, waste transfer). A line is identified by its
 * `ricardoReleaseTransferId`, which is unique across the report's arrays —
 * more robust than an array index.
 */
const PERCENT = 100

function percentOf(part, whole) {
  if (!whole) {
    return 0
  }
  return Math.round((part / whole) * PERCENT)
}

function toMethodAndConfidentiality(entry, method, confidentialReason) {
  return {
    methodBasis: entry.methodBasisCode ?? null,
    methodDescription: method?.methodDescription ?? null,
    // null => the FE renders "None"
    confidentiality: confidentialReason
      ? { code: confidentialReason.code, name: confidentialReason.name }
      : null
  }
}

function toReceiverCompany(handler) {
  if (!handler) {
    return null
  }
  return { name: handler.name ?? null, address: handler.address ?? null }
}

function toWasteDetail(entry) {
  const handler = entry.wasteHandlerParty
  return {
    kind: 'waste',
    wasteTypeCode: entry.wasteTypeCode ?? null,
    treatment: entry.wasteTreatmentCode ?? null,
    quantity: entry.quantity ?? null,
    receiverCompany: toReceiverCompany(handler),
    site: handler?.siteAddress ?? null
  }
}

function toPollutantDetail(kind, entry) {
  // Transfers carry no accidentalQuantity in the source — default to zero.
  const accidental = entry.accidentalQuantity?.value ?? 0
  const total = entry.totalQuantity?.value ?? null

  return {
    kind, // 'release' | 'transfer'
    medium: entry.mediumCode ?? null, // AIR | WATER | LAND (null for a transfer)
    pollutant: entry.pollutantName,
    total: entry.totalQuantity ?? null,
    // Reporting thresholds are not in the Ricardo export yet.
    threshold: null,
    accidental,
    percentAccidental: percentOf(accidental, total)
  }
}

/**
 * Shape a located line into the additional-detail DTO.
 * Pure — exported for unit testing.
 */
export function toAdditionalDetail(
  { kind, entry },
  method,
  confidentialReason
) {
  const detail =
    kind === 'waste' ? toWasteDetail(entry) : toPollutantDetail(kind, entry)

  return {
    ...detail,
    ...toMethodAndConfidentiality(entry, method, confidentialReason)
  }
}

/**
 * Locate a line in a report by its ricardoReleaseTransferId.
 * Pure — exported for unit testing.
 *
 * @returns {{ kind: 'release'|'transfer'|'waste', entry: object }|null}
 */

export function findLine(report, lineId) {
  for (const entry of report.pollutantReleases ?? []) {
    if (entry.ricardoReleaseTransferId === lineId) {
      return { kind: 'release', entry }
    }
  }
  for (const entry of report.pollutantTransfers ?? []) {
    if (entry.ricardoReleaseTransferId === lineId) {
      return { kind: 'transfer', entry }
    }
  }
  for (const entry of report.wasteTransfers ?? []) {
    if (entry.ricardoReleaseTransferId === lineId) {
      return { kind: 'waste', entry }
    }
  }
  return null
}
/**
 * Fetch the additional detail of one line.
 *
 * @param {import('mongodb').Db} db
 * @param {string} internalFacilityId
 * @param {number} reportingYear
 * @param {number} lineId - ricardoReleaseTransferId
 * @returns {Promise<object|null>} null when the report or the line is missing
 */
export async function getAdditionalDetail(
  db,
  internalFacilityId,
  reportingYear,
  lineId
) {
  const report = await db.collection('facility_reports').findOne(
    { internalFacilityId, reportingYear },
    {
      projection: {
        _id: 0,
        pollutantReleases: 1,
        pollutantTransfers: 1,
        wasteTransfers: 1
      }
    }
  )

  if (!report) {
    return null
  }

  const line = findLine(report, lineId)
  if (!line) {
    return null
  }

  const { methodTypeCode, confidentialityReasonCode } = line.entry

  const [method, confidentialReason] = await Promise.all([
    methodTypeCode
      ? db
          .collection('methods')
          .findOne(
            { _id: methodTypeCode },
            { projection: { _id: 0, methodBasisCode: 1, methodDescription: 1 } }
          )
      : null,
    confidentialityReasonCode
      ? db
          .collection('confidential_reasons')
          .findOne(
            { _id: confidentialityReasonCode },
            { projection: { _id: 0, code: 1, name: 1 } }
          )
      : null
  ])

  return toAdditionalDetail(line, method, confidentialReason)
}
