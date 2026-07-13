import { describe, it, expect, vi, beforeEach } from 'vitest'

import { statusCodes } from '#src/common/constants/status-codes.js'
import {
  handleCompetentAuthority,
  competentAuthority
} from '#src/routes/competent-authority.js'
import { getCompetentAuthority } from '#src/services/competent-authority-service.js'

vi.mock('#src/services/competent-authority-service.js', () => ({
  getCompetentAuthority: vi.fn()
}))

function buildH() {
  const code = vi.fn((c) => ({ statusCode: c }))
  const response = vi.fn(() => ({ code }))
  return { h: { response }, response, code }
}

const fakeDb = { collection: vi.fn() } // request.db is a property, not a function
const VALID_ID = 'f-20bb38aa47c991bab94b8d7ae0a1101b'

const AUTHORITY = {
  facilityId: VALID_ID,
  facilityName: 'Brunswick Waste Reception Site',
  sourceYear: 2024,
  name: 'Environment Agency (EA)',
  agency: 'EA',
  contactPersonName: 'Pollution Inventory team',
  address: {
    street: 'Parkway Avenue',
    building: 'Quadrant Two',
    city: 'Sheffield',
    postcode: 'S9 4WF'
  },
  telephone: '+44 03708506506',
  fax: null,
  email: 'pollution.inventory@environment-agency.gov.uk'
}

describe('handleCompetentAuthority', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the latest competent authority for a known facility', async () => {
    getCompetentAuthority.mockResolvedValue(AUTHORITY)
    const { h, response, code } = buildH()

    await handleCompetentAuthority({ params: { id: VALID_ID }, db: fakeDb }, h)

    expect(getCompetentAuthority).toHaveBeenCalledWith(fakeDb, VALID_ID)
    expect(response.mock.calls[0][0]).toMatchObject({
      name: 'Environment Agency (EA)',
      contactPersonName: 'Pollution Inventory team',
      sourceYear: 2024
    })
    expect(code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('does not take a year — the authority is year-independent', async () => {
    getCompetentAuthority.mockResolvedValue(AUTHORITY)
    const { h } = buildH()

    await handleCompetentAuthority({ params: { id: VALID_ID }, db: fakeDb }, h)

    // service is called with the db and id only
    expect(getCompetentAuthority).toHaveBeenCalledTimes(1)
    expect(getCompetentAuthority.mock.calls[0]).toHaveLength(2)
  })

  it('returns a Boom 404 when the facility does not exist', async () => {
    getCompetentAuthority.mockResolvedValue(null)
    const { h, response } = buildH()

    const result = await handleCompetentAuthority(
      { params: { id: VALID_ID }, db: fakeDb },
      h
    )

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(statusCodes.notFound)
    expect(response).not.toHaveBeenCalled()
  })

  it('wraps an unexpected service error as a Boom 500', async () => {
    getCompetentAuthority.mockRejectedValue(new Error('mongo down'))
    const { h } = buildH()

    await expect(
      handleCompetentAuthority({ params: { id: VALID_ID }, db: fakeDb }, h)
    ).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: statusCodes.internalServerError }
    })
  })
})

describe('competentAuthority route', () => {
  const schema = () => competentAuthority[0].options.validate.params

  it('is wired GET /facilities/{id}/competent-authority with params validation', () => {
    expect(competentAuthority[0]).toMatchObject({
      method: 'GET',
      path: '/facilities/{id}/competent-authority'
    })
    expect(competentAuthority[0].handler).toBe(handleCompetentAuthority)
    expect(competentAuthority[0].options.validate.params).toBeDefined()
  })

  it('accepts a valid internalFacilityId', () => {
    expect(schema().validate({ id: VALID_ID }).error).toBeUndefined()
  })

  it('rejects a malformed or missing internalFacilityId', () => {
    expect(schema().validate({ id: 'not-an-id' }).error).toBeDefined()
    expect(schema().validate({ id: 'f-ZZZ' }).error).toBeDefined() // wrong charset/length
    expect(schema().validate({}).error).toBeDefined() // id is required
  })

  it('does not accept a year param', () => {
    expect(
      schema().validate({ id: VALID_ID, year: 2024 }).error
    ).toBeDefined() // Joi.object() is strict by default — unknown keys rejected
  })
})
