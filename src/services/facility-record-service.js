const mapRelease = (e) => ({
  lineId: e.ricardoReleaseTransferId,
  pollutantId: e.pollutantId,
  pollutant: e.pollutantName,
  value: e.totalQuantity?.value ?? null,
  unit: e.totalQuantity?.unit ?? null,
  threshold: null // pollutant_threshold not in the Ricardo export yet
})

const mapWaste = (e) => ({
  lineId: e.ricardoReleaseTransferId,
  value: e.quantity?.value ?? null,
  unit: e.quantity?.unit ?? null,
  wasteTypeCode: e.wasteTypeCode ?? null,
  treatment: e.wasteTreatmentCode ?? null
})

/**
 * Shape a facility header + one year's report into the record-page DTO.
 * Pure — exported for unit testing.
 */
export function toFacilityRecord(header, report, year) {
  const releases = report?.pollutantReleases ?? []
  return {
    facility: {
      id: header.internalFacilityId,
      name: header.facilityName,
      nationalId: header.facilityCode,
      reportingYears: (header.reportingYears ?? [])
        .slice()
        .sort((a, b) => b - a)
    },
    year,
    releasesToAir: releases
      .filter((r) => r.mediumCode === 'AIR')
      .map(mapRelease),
    releasesToWater: releases
      .filter((r) => r.mediumCode === 'WATER')
      .map(mapRelease),
    releasesToSoil: releases
      .filter((r) => r.mediumCode === 'LAND')
      .map(mapRelease),
    transfersToWasteWater: (report?.pollutantTransfers ?? []).map(mapRelease),
    wasteTransfers: (report?.wasteTransfers ?? []).map(mapWaste)
  }
}

/**
 * A facility's releases & transfers for a year.
 * Year defaults to the facility's latest reporting year.
 *
 * @param {import('mongodb').Db} db
 * @param {string} internalFacilityId
 * @param {number} [year]
 * @returns {Promise<object|null>} null when the facility does not exist
 */
export async function getFacilityRecord(db, internalFacilityId, year) {
  const header = await db.collection('facilities').findOne(
    { internalFacilityId },
    {
      projection: {
        _id: 0,
        internalFacilityId: 1,
        facilityName: 1,
        facilityCode: 1,
        reportingYears: 1,
        latestReportingYear: 1
      }
    }
  )
  if (!header) return null

  const reportingYear = year ?? header.latestReportingYear
  const report = await db
    .collection('facility_reports')
    .findOne(
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

  return toFacilityRecord(header, report, reportingYear)
}
