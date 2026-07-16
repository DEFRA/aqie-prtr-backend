import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  toFacilityRecord,
  getFacilityRecord
} from '#src/services/facility-record-service.js'

const HEADER = {
  internalFacilityId: 'f-1',
  facilityName: 'Brunswick Waste Reception Site',
  facilityCode: 'EW_EA-13989',
  reportingYears: [2023, 2024],
  latestReportingYear: 2024
}

const REPORT = {
  pollutantReleases: [
    {
      ricardoReleaseTransferId: 7,
      pollutantId: 72,
      pollutantName: 'Lead',
      mediumCode: 'AIR',
      totalQuantity: { value: 612, unit: 'KGM' }
    },
    {
      ricardoReleaseTransferId: 8,
      pollutantId: 80,
      pollutantName: 'Zinc',
      mediumCode: 'LAND',
      totalQuantity: { value: 3460, unit: 'KGM' }
    },
    {
      ricardoReleaseTransferId: 10,
      pollutantId: 90,
      pollutantName: 'NP/NPEs',
      mediumCode: 'WATER',
      totalQuantity: { value: 110, unit: 'KGM' }
    }
  ],
  pollutantTransfers: [
    {
      ricardoReleaseTransferId: 11,
      pollutantId: 76,
      pollutantName: 'Nickel',
      totalQuantity: { value: 24, unit: 'KGM' }
    }
  ],
  wasteTransfers: [
    {
      ricardoReleaseTransferId: 9,
      wasteTypeCode: 'NONHW',
      wasteTreatmentCode: 'Recovery',
      quantity: { value: 134982, unit: 'TNE' }
    }
  ]
}

/** db mock returning a different findOne per collection. */
function buildDb({ header, report }) {
  const facilitiesFindOne = vi.fn().mockResolvedValue(header)
  const reportsFindOne = vi.fn().mockResolvedValue(report)
  const collection = vi.fn((name) => {
    if (name === 'facilities') return { findOne: facilitiesFindOne }
    if (name === 'facility_reports') return { findOne: reportsFindOne }
    throw new Error(`unexpected collection: ${name}`)
  })
  return { db: { collection }, facilitiesFindOne, reportsFindOne, collection }
}

describe('toFacilityRecord', () => {
  it('groups releases by medium, sorts years desc and carries lineIds', () => {
    const out = toFacilityRecord(HEADER, REPORT, 2024)

    expect(out.facility).toEqual({
      id: 'f-1',
      name: 'Brunswick Waste Reception Site',
      nationalId: 'EW_EA-13989',
      reportingYears: [2024, 2023] // sorted desc
    })
    expect(out.year).toBe(2024)
    expect(out.releasesToAir).toEqual([
      {
        lineId: 7,
        pollutantId: 72,
        pollutant: 'Lead',
        value: 612,
        unit: 'KGM',
        threshold: null
      }
    ])
    expect(out.releasesToWater[0]).toMatchObject({
      lineId: 10,
      pollutant: 'NP/NPEs'
    })
    expect(out.releasesToSoil[0]).toMatchObject({
      lineId: 8,
      pollutant: 'Zinc'
    }) // LAND -> soil
    expect(out.transfersToWasteWater[0]).toMatchObject({
      lineId: 11,
      pollutant: 'Nickel'
    })
    expect(out.wasteTransfers).toEqual([
      {
        lineId: 9,
        value: 134982,
        unit: 'TNE',
        wasteTypeCode: 'NONHW',
        treatment: 'Recovery'
      }
    ])
  })

  it('does not mutate the source reportingYears array', () => {
    const header = { ...HEADER, reportingYears: [2023, 2024] }
    toFacilityRecord(header, REPORT, 2024)
    expect(header.reportingYears).toEqual([2023, 2024]) // .slice() guard
  })

  it('returns empty sections when there is no report for the year', () => {
    const out = toFacilityRecord(HEADER, null, 2024)
    expect(out.releasesToAir).toEqual([])
    expect(out.releasesToWater).toEqual([])
    expect(out.releasesToSoil).toEqual([])
    expect(out.transfersToWasteWater).toEqual([])
    expect(out.wasteTransfers).toEqual([])
  })

  it('defaults reportingYears to [] when the facility has none', () => {
    const out = toFacilityRecord({ internalFacilityId: 'f-1' }, null, 2024)
    expect(out.facility.reportingYears).toEqual([])
  })

  it('nulls missing quantities/codes rather than throwing', () => {
    const out = toFacilityRecord(
      HEADER,
      {
        pollutantReleases: [{ ricardoReleaseTransferId: 1, mediumCode: 'AIR' }], // no totalQuantity
        pollutantTransfers: [{ ricardoReleaseTransferId: 2 }], // no totalQuantity
        wasteTransfers: [{ ricardoReleaseTransferId: 3 }] // no quantity/codes
      },
      2024
    )
    expect(out.releasesToAir[0]).toMatchObject({
      value: null,
      unit: null,
      threshold: null
    })
    expect(out.transfersToWasteWater[0]).toMatchObject({
      value: null,
      unit: null
    })
    expect(out.wasteTransfers[0]).toEqual({
      lineId: 3,
      value: null,
      unit: null,
      wasteTypeCode: null,
      treatment: null
    })
  })

  it('ignores releases with an unknown or missing medium', () => {
    const out = toFacilityRecord(
      HEADER,
      {
        pollutantReleases: [{ ricardoReleaseTransferId: 1, mediumCode: null }]
      },
      2024
    )
    expect(out.releasesToAir).toEqual([])
    expect(out.releasesToWater).toEqual([])
    expect(out.releasesToSoil).toEqual([])
  })
})

describe('getFacilityRecord', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null and does not query reports when the facility is missing', async () => {
    const { db, reportsFindOne } = buildDb({ header: null, report: null })

    const out = await getFacilityRecord(db, 'f-missing', 2024)

    expect(out).toBeNull()
    expect(reportsFindOne).not.toHaveBeenCalled() // short-circuits
  })

  it('queries facilities by internalFacilityId with a projection', async () => {
    const { db, facilitiesFindOne, collection } = buildDb({
      header: HEADER,
      report: REPORT
    })

    await getFacilityRecord(db, 'f-1', 2024)

    expect(collection).toHaveBeenCalledWith('facilities')
    expect(facilitiesFindOne).toHaveBeenCalledWith(
      { internalFacilityId: 'f-1' },
      {
        projection: expect.objectContaining({
          _id: 0,
          facilityName: 1,
          reportingYears: 1
        })
      }
    )
  })

  it('uses the requested year and returns the shaped record', async () => {
    const { db, reportsFindOne } = buildDb({ header: HEADER, report: REPORT })

    const out = await getFacilityRecord(db, 'f-1', 2023)

    expect(reportsFindOne).toHaveBeenCalledWith(
      { internalFacilityId: 'f-1', reportingYear: 2023 },
      {
        projection: expect.objectContaining({
          _id: 0,
          pollutantReleases: 1,
          wasteTransfers: 1
        })
      }
    )
    expect(out.year).toBe(2023)
    expect(out.releasesToAir).toHaveLength(1)
  })

  it('falls back to latestReportingYear when no year is given', async () => {
    const { db, reportsFindOne } = buildDb({ header: HEADER, report: REPORT })

    const out = await getFacilityRecord(db, 'f-1', undefined)

    expect(reportsFindOne).toHaveBeenCalledWith(
      { internalFacilityId: 'f-1', reportingYear: 2024 }, // latestReportingYear
      expect.any(Object)
    )
    expect(out.year).toBe(2024)
  })

  it('still returns a record (with empty sections) when the year has no report', async () => {
    const { db } = buildDb({ header: HEADER, report: null })

    const out = await getFacilityRecord(db, 'f-1', 2011)

    expect(out.year).toBe(2011)
    expect(out.facility.name).toBe('Brunswick Waste Reception Site')
    expect(out.wasteTransfers).toEqual([])
  })
})
