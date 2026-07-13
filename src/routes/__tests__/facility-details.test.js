import { describe, it, expect, vi, beforeEach } from 'vitest'
import { statusCodes } from '#src/common/constants/status-codes.js'

vi.mock('#src/services/facility-details-service.js', () => ({
  getFacilityDetails: vi.fn()
}))

import {
  handleFacilityDetails,
  facilityDetails
} from '#src/routes/facility-details.js'
import { getFacilityDetails } from '#src/services/facility-details-service.js'

function buildH() {
  const code = vi.fn((c) => ({ statusCode: c }))
  const response = vi.fn(() => ({ code }))
  return { h: { response }, response, code }
}

const fakeDb = { collection: vi.fn() }
const VALID_ID = 'f-20bb38aa47c991bab94b8d7ae0a1101b'

describe('handleFacilityDetails', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the details for a known facility', async () => {
    getFacilityDetails.mockResolvedValue({ id: VALID_ID, name: 'Brunswick' })
    const { h, response, code } = buildH()

    await handleFacilityDetails({ params: { id: VALID_ID }, db: fakeDb }, h)

    expect(getFacilityDetails).toHaveBeenCalledWith(fakeDb, VALID_ID)
    expect(response.mock.calls[0][0]).toMatchObject({ name: 'Brunswick' })
    expect(code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('returns a Boom 404 when the facility does not exist', async () => {
    getFacilityDetails.mockResolvedValue(null)
    const { h, response } = buildH()

    const result = await handleFacilityDetails(
      { params: { id: VALID_ID }, db: fakeDb },
      h
    )

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(statusCodes.notFound)
    expect(response).not.toHaveBeenCalled()
  })

  it('wraps an unexpected service error as a Boom 500', async () => {
    getFacilityDetails.mockRejectedValue(new Error('mongo down'))
    const { h } = buildH()

    await expect(
      handleFacilityDetails({ params: { id: VALID_ID }, db: fakeDb }, h)
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: statusCodes.internalServerError }
    })
  })
})

describe('facilityDetails route', () => {
  const schema = () => facilityDetails[0].options.validate.params

  it('is wired GET /facilities/{id}/details with params validation', () => {
    expect(facilityDetails[0]).toMatchObject({
      method: 'GET',
      path: '/facilities/{id}/details'
    })
    expect(facilityDetails[0].handler).toBe(handleFacilityDetails)
  })

  it('accepts a valid internalFacilityId', () => {
    expect(schema().validate({ id: VALID_ID }).error).toBeUndefined()
  })

  it('rejects a malformed or missing internalFacilityId', () => {
    expect(schema().validate({ id: 'not-an-id' }).error).toBeDefined()
    expect(schema().validate({}).error).toBeDefined()
  })
})
