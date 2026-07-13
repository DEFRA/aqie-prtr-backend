import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('#src/services/additional-detail-service.js', () => ({
  getAdditionalDetail: vi.fn()
}))

import { statusCodes } from '#src/common/constants/status-codes.js'
import {
  handleAdditionalDetail,
  additionalDetail
} from '#src/routes/additional-detail.js'
import { getAdditionalDetail } from '#src/services/additional-detail-service.js'

const VALID_ID = 'f-20bb38aa47c991bab94b8d7ae0a1101b'
const MIN_YEAR = 2007
const YEAR = 2024
const YEAR_BELOW_MIN = MIN_YEAR - 1
const LINE_ID = 7
const LEAD_KG = 612

function buildH() {
  const code = vi.fn((c) => ({ statusCode: c }))
  const response = vi.fn(() => ({ code }))
  return { h: { response }, response, code }
}

const fakeDb = { collection: vi.fn() }

const DETAIL = {
  kind: 'release',
  medium: 'AIR',
  pollutant: 'Lead and compounds (as Pb)',
  total: { value: LEAD_KG, unit: 'KGM' },
  threshold: null,
  accidental: 0,
  percentAccidental: 0,
  methodBasis: 'Measured',
  methodDescription: 'Measurement by weighing.',
  confidentiality: null
}

describe('handleAdditionalDetail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the line detail, coercing year and lineId to numbers', async () => {
    getAdditionalDetail.mockResolvedValue(DETAIL)
    const { h, response, code } = buildH()

    await handleAdditionalDetail(
      {
        params: { id: VALID_ID, year: String(YEAR), lineId: String(LINE_ID) },
        db: fakeDb
      },
      h
    )

    expect(getAdditionalDetail).toHaveBeenCalledWith(
      fakeDb,
      VALID_ID,
      YEAR,
      LINE_ID
    )
    expect(response.mock.calls[0][0]).toMatchObject({
      kind: 'release',
      medium: 'AIR'
    })
    expect(code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('returns a Boom not-found when the line does not exist', async () => {
    getAdditionalDetail.mockResolvedValue(null)
    const { h, response } = buildH()

    const result = await handleAdditionalDetail(
      { params: { id: VALID_ID, year: YEAR, lineId: LINE_ID }, db: fakeDb },
      h
    )

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(statusCodes.notFound)
    expect(response).not.toHaveBeenCalled()
  })

  it('wraps an unexpected service error as a Boom internal server error', async () => {
    getAdditionalDetail.mockRejectedValue(new Error('mongo down'))
    const { h } = buildH()

    await expect(
      handleAdditionalDetail(
        { params: { id: VALID_ID, year: YEAR, lineId: LINE_ID }, db: fakeDb },
        h
      )
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: statusCodes.internalServerError }
    })
  })
})

describe('additionalDetail route', () => {
  const schema = () => additionalDetail[0].options.validate.params

  it('is wired GET /facilities/{id}/record/{year}/lines/{lineId}', () => {
    expect(additionalDetail[0]).toMatchObject({
      method: 'GET',
      path: '/facilities/{id}/record/{year}/lines/{lineId}'
    })
    expect(additionalDetail[0].handler).toBe(handleAdditionalDetail)
  })

  it('accepts a valid id, year and lineId', () => {
    const { error } = schema().validate({
      id: VALID_ID,
      year: YEAR,
      lineId: LINE_ID
    })
    expect(error).toBeUndefined()
  })

  it('requires the year and the lineId', () => {
    expect(
      schema().validate({ id: VALID_ID, lineId: LINE_ID }).error
    ).toBeDefined()
    expect(schema().validate({ id: VALID_ID, year: YEAR }).error).toBeDefined()
  })

  it('rejects a malformed id, an out-of-range year, or a non-integer lineId', () => {
    expect(
      schema().validate({ id: 'nope', year: YEAR, lineId: LINE_ID }).error
    ).toBeDefined()
    expect(
      schema().validate({ id: VALID_ID, year: YEAR_BELOW_MIN, lineId: LINE_ID })
        .error
    ).toBeDefined()
    expect(
      schema().validate({ id: VALID_ID, year: YEAR, lineId: 'abc' }).error
    ).toBeDefined()
  })
})
