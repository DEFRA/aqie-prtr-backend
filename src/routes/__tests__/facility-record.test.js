import { describe, it, expect, vi, beforeEach } from 'vitest'
import { statusCodes } from '#src/common/constants/status-codes.js'

vi.mock('#src/services/facility-record-service.js', () => ({
  getFacilityRecord: vi.fn()
}))

import {
  handleFacilityRecord,
  facilityRecord
} from '#src/routes/facility-record.js'
import { getFacilityRecord } from '#src/services/facility-record-service.js'

function buildH() {
  const code = vi.fn((c) => ({ statusCode: c }))
  const response = vi.fn(() => ({ code }))
  return { h: { response }, response, code }
}

const fakeDb = { collection: vi.fn() } // request.db is a property, not a function
const VALID_ID = 'f-20bb38aa47c991bab94b8d7ae0a1101b'

const sampleRecord = {
  facility: {
    id: VALID_ID,
    name: 'Brunswick Waste Reception Site',
    nationalId: 'EW_EA-13989',
    reportingYears: [2024, 2023]
  },
  year: 2024,
  releasesToAir: [
    {
      lineId: 7,
      pollutantId: 72,
      pollutant: 'Lead',
      value: 612,
      unit: 'KGM',
      threshold: null
    }
  ],
  releasesToWater: [],
  releasesToSoil: [],
  transfersToWasteWater: [],
  wasteTransfers: [
    {
      lineId: 9,
      value: 134982,
      unit: 'TNE',
      wasteTypeCode: 'NONHW',
      treatment: 'Recovery'
    }
  ]
}

describe('handleFacilityRecord', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the record for the requested year', async () => {
    getFacilityRecord.mockResolvedValue(sampleRecord)
    const { h, response, code } = buildH()

    await handleFacilityRecord(
      { params: { id: VALID_ID, year: '2024' }, db: fakeDb },
      h
    )

    expect(getFacilityRecord).toHaveBeenCalledWith(fakeDb, VALID_ID, 2024)
    expect(response.mock.calls[0][0]).toMatchObject({
      year: 2024,
      facility: { id: VALID_ID, reportingYears: [2024, 2023] }
    })
    expect(code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('passes year as undefined when omitted, so the service defaults to latest', async () => {
    getFacilityRecord.mockResolvedValue(sampleRecord)
    const { h } = buildH()

    await handleFacilityRecord({ params: { id: VALID_ID }, db: fakeDb }, h)

    expect(getFacilityRecord).toHaveBeenCalledWith(fakeDb, VALID_ID, undefined)
  })

  it('returns a Boom 404 when the facility does not exist', async () => {
    getFacilityRecord.mockResolvedValue(null)
    const { h, response } = buildH()

    const result = await handleFacilityRecord(
      { params: { id: VALID_ID }, db: fakeDb },
      h
    )

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(statusCodes.notFound)
    expect(response).not.toHaveBeenCalled()
  })

  it('wraps an unexpected service error as a Boom 500', async () => {
    getFacilityRecord.mockRejectedValue(new Error('mongo down'))
    const { h } = buildH()

    await expect(
      handleFacilityRecord({ params: { id: VALID_ID }, db: fakeDb }, h)
    ).rejects.toMatchObject({ isBoom: true, output: { statusCode: statusCodes.internalServerError } })
  })
})

describe('facilityRecord route', () => {
  const schema = () => facilityRecord[0].options.validate.params

  it('is wired GET /facilities/{id}/record/{year?} with params validation', () => {
    expect(facilityRecord[0]).toMatchObject({
      method: 'GET',
      path: '/facilities/{id}/record/{year?}'
    })
    expect(facilityRecord[0].handler).toBe(handleFacilityRecord)
    expect(facilityRecord[0].options.validate.params).toBeDefined()
  })

  it('accepts a valid id with no year (year is optional)', () => {
    expect(schema().validate({ id: VALID_ID }).error).toBeUndefined()
  })

  it('accepts a valid id and year, coercing the year to a number', () => {
    const { value, error } = schema().validate({ id: VALID_ID, year: '2023' })
    expect(error).toBeUndefined()
    expect(value.year).toBe(2023)
  })

  it('rejects a malformed internalFacilityId', () => {
    expect(schema().validate({ id: 'not-an-id' }).error).toBeDefined()
    expect(schema().validate({ id: 'f-ZZZ' }).error).toBeDefined() // wrong charset/length
    expect(schema().validate({}).error).toBeDefined() // id is required
  })

  it('rejects a year outside the allowed range', () => {
    expect(schema().validate({ id: VALID_ID, year: 2006 }).error).toBeDefined()
    expect(schema().validate({ id: VALID_ID, year: 3000 }).error).toBeDefined()
  })
})
