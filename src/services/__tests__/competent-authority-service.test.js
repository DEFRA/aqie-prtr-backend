import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  toCompetentAuthority,
  getCompetentAuthority
} from '#src/services/competent-authority-service.js'

const FACILITY = {
  internalFacilityId: 'f-1',
  facilityName: 'Brunswick Waste Reception Site',
  competentAuthority: {
    regulatoryAuthority: { code: 'EA', name: 'Environment Agency (EA)' },
    agency: { acronym: 'EA', name: 'EA' }
  }
}

const REPORT = {
  reportingYear: 2024,
  competentAuthority: {
    regulatoryAuthority: { code: 'EA', name: 'Environment Agency (EA)' },
    agency: { acronym: 'EA', name: 'EA' },
    contact: {
      contactPersonName: 'Pollution Inventory team',
      address: {
        streetName: 'Parkway Avenue',
        buildingNumber: 'Quadrant Two',
        cityName: 'Sheffield',
        postcodeCode: 'S9 4WF'
      },
      telephone: '+44 03708506506',
      fax: null,
      email: 'pollution.inventory@environment-agency.gov.uk'
    }
  }
}

function buildDb({ facility, report }) {
  const facilitiesFindOne = vi.fn().mockResolvedValue(facility)
  const reportsFindOne = vi.fn().mockResolvedValue(report)
  const collection = vi.fn((name) => {
    if (name === 'facilities') return { findOne: facilitiesFindOne }
    if (name === 'facility_reports') return { findOne: reportsFindOne }
    throw new Error(`unexpected collection: ${name}`)
  })
  return { db: { collection }, facilitiesFindOne, reportsFindOne }
}

describe('toCompetentAuthority', () => {
  it('maps the authority name, contact person, address, phone, fax and email', () => {
    expect(toCompetentAuthority(FACILITY, REPORT)).toEqual({
      facilityId: 'f-1',
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
    })
  })

  it('falls back to the facility authority when no report carries contact details', () => {
    const out = toCompetentAuthority(FACILITY, null)
    expect(out.name).toBe('Environment Agency (EA)')
    expect(out.sourceYear).toBeNull()
    expect(out.address).toBeNull()
    expect(out.telephone).toBeNull()
  })

  it('returns nulls when the facility has no competent authority at all', () => {
    const out = toCompetentAuthority({ internalFacilityId: 'f-2', facilityName: 'X' }, null)
    expect(out.name).toBeNull()
    expect(out.agency).toBeNull()
    expect(out.address).toBeNull()
  })
})

describe('getCompetentAuthority', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null and does not query reports when the facility is missing', async () => {
    const { db, reportsFindOne } = buildDb({ facility: null, report: null })
    expect(await getCompetentAuthority(db, 'f-missing')).toBeNull()
    expect(reportsFindOne).not.toHaveBeenCalled()
  })

  it('asks for the LATEST report that has contact details, regardless of year', async () => {
    const { db, reportsFindOne } = buildDb({ facility: FACILITY, report: REPORT })

    await getCompetentAuthority(db, 'f-1')

    expect(reportsFindOne).toHaveBeenCalledWith(
      { internalFacilityId: 'f-1', 'competentAuthority.contact': { $ne: null } },
      expect.objectContaining({ sort: { reportingYear: -1 } })
    )
  })

  it('returns the shaped DTO from the latest CA-bearing report', async () => {
    const { db } = buildDb({ facility: FACILITY, report: REPORT })
    const out = await getCompetentAuthority(db, 'f-1')
    expect(out.sourceYear).toBe(2024)
    expect(out.contactPersonName).toBe('Pollution Inventory team')
  })
})
