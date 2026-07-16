import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  findLine,
  toAdditionalDetail,
  getAdditionalDetail
} from '#src/services/additional-detail-service.js'

const YEAR = 2024
const AIR_LINE_ID = 7
const TRANSFER_LINE_ID = 11
const WASTE_LINE_ID = 9
const MISSING_LINE_ID = 999
const LEAD_KG = 612
const ACCIDENTAL_KG = 61
const EXPECTED_PERCENT = 10
const NICKEL_KG = 24
const WASTE_TONNES = 134982

const AIR_ENTRY = {
  ricardoReleaseTransferId: AIR_LINE_ID,
  pollutantName: 'Lead and compounds (as Pb)',
  mediumCode: 'AIR',
  totalQuantity: { value: LEAD_KG, unit: 'KGM' },
  accidentalQuantity: { value: ACCIDENTAL_KG, unit: 'KGM' },
  methodTypeCode: 'M_WEIGH',
  methodBasisCode: 'Measured',
  confidentialityReasonCode: null
}

const TRANSFER_ENTRY = {
  ricardoReleaseTransferId: TRANSFER_LINE_ID,
  pollutantName: 'Nickel and compounds (as Ni)',
  totalQuantity: { value: NICKEL_KG, unit: 'KGM' },
  methodTypeCode: 'E',
  methodBasisCode: 'Estimated',
  confidentialityReasonCode: null
}

const WASTE_ENTRY = {
  ricardoReleaseTransferId: WASTE_LINE_ID,
  wasteTypeCode: 'HWOC',
  wasteTreatmentCode: 'Disposal',
  quantity: { value: WASTE_TONNES, unit: 'TNE' },
  methodTypeCode: 'M_WEIGH',
  methodBasisCode: 'Measured',
  confidentialityReasonCode: 'A42d',
  wasteHandlerParty: {
    name: 'Nickelhutte Aue GmbH',
    address: {
      streetName: 'Rudolph-Breitscheld-Strasse',
      cityName: null,
      postcodeCode: 'D-08280',
      countryName: 'Germany'
    },
    siteAddress: {
      streetName: 'Rudolph-Breitscheld-Strasse',
      cityName: null,
      postcodeCode: 'D-08280'
    }
  }
}

const REPORT = {
  pollutantReleases: [AIR_ENTRY],
  pollutantTransfers: [TRANSFER_ENTRY],
  wasteTransfers: [WASTE_ENTRY]
}

const METHOD = {
  methodBasisCode: 'Measured',
  methodDescription: 'Measurement by weighing.'
}
const REASON = { code: 'A42d', name: 'Article 4(2)(d) of Directive 2003/4/EC' }

function buildDb({ report, method, reason }) {
  const reportsFindOne = vi.fn().mockResolvedValue(report)
  const methodsFindOne = vi.fn().mockResolvedValue(method)
  const reasonsFindOne = vi.fn().mockResolvedValue(reason)
  const collection = vi.fn((name) => {
    if (name === 'facility_reports') return { findOne: reportsFindOne }
    if (name === 'methods') return { findOne: methodsFindOne }
    if (name === 'confidential_reasons') return { findOne: reasonsFindOne }
    throw new Error(`unexpected collection: ${name}`)
  })
  return { db: { collection }, reportsFindOne, methodsFindOne, reasonsFindOne }
}

describe('findLine', () => {
  it('finds a release, a transfer and a waste line by ricardoReleaseTransferId', () => {
    expect(findLine(REPORT, AIR_LINE_ID)).toMatchObject({ kind: 'release' })
    expect(findLine(REPORT, TRANSFER_LINE_ID)).toMatchObject({
      kind: 'transfer'
    })
    expect(findLine(REPORT, WASTE_LINE_ID)).toMatchObject({ kind: 'waste' })
  })

  it('returns null for an unknown line', () => {
    expect(findLine(REPORT, MISSING_LINE_ID)).toBeNull()
  })

  it('tolerates a report with missing arrays', () => {
    expect(findLine({}, AIR_LINE_ID)).toBeNull()
  })
})

describe('toAdditionalDetail', () => {
  it('shapes a release, computing the accidental percentage', () => {
    const dto = toAdditionalDetail(
      { kind: 'release', entry: AIR_ENTRY },
      METHOD,
      null
    )

    expect(dto).toMatchObject({
      kind: 'release',
      medium: 'AIR',
      pollutant: 'Lead and compounds (as Pb)',
      total: { value: LEAD_KG, unit: 'KGM' },
      threshold: null,
      accidental: ACCIDENTAL_KG,
      percentAccidental: EXPECTED_PERCENT,
      methodBasis: 'Measured',
      methodDescription: 'Measurement by weighing.',
      confidentiality: null
    })
  })

  it('defaults a transfer accidental quantity to zero (the source has none)', () => {
    const dto = toAdditionalDetail(
      { kind: 'transfer', entry: TRANSFER_ENTRY },
      METHOD,
      null
    )
    expect(dto.accidental).toBe(0)
    expect(dto.percentAccidental).toBe(0)
    expect(dto.medium).toBeNull()
  })

  it('shapes a waste transfer with receiver company, site and confidentiality', () => {
    const dto = toAdditionalDetail(
      { kind: 'waste', entry: WASTE_ENTRY },
      METHOD,
      REASON
    )

    expect(dto).toMatchObject({
      kind: 'waste',
      wasteTypeCode: 'HWOC',
      treatment: 'Disposal',
      quantity: { value: WASTE_TONNES, unit: 'TNE' },
      confidentiality: {
        code: 'A42d',
        name: 'Article 4(2)(d) of Directive 2003/4/EC'
      }
    })
    expect(dto.receiverCompany.name).toBe('Nickelhutte Aue GmbH')
    expect(dto.site.postcodeCode).toBe('D-08280')
  })

  it('nulls receiver company and site when there is no waste handler', () => {
    const dto = toAdditionalDetail(
      { kind: 'waste', entry: { ...WASTE_ENTRY, wasteHandlerParty: null } },
      METHOD,
      null
    )
    expect(dto.receiverCompany).toBeNull()
    expect(dto.site).toBeNull()
  })

  it('percentAccidental is zero when the total is zero', () => {
    const dto = toAdditionalDetail(
      {
        kind: 'release',
        entry: { ...AIR_ENTRY, totalQuantity: { value: 0, unit: 'KGM' } }
      },
      METHOD,
      null
    )
    expect(dto.percentAccidental).toBe(0)
  })
})

describe('getAdditionalDetail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when the report does not exist', async () => {
    const { db, methodsFindOne } = buildDb({ report: null })
    expect(await getAdditionalDetail(db, 'f-1', YEAR, AIR_LINE_ID)).toBeNull()
    expect(methodsFindOne).not.toHaveBeenCalled()
  })

  it('returns null when the line is not in the report', async () => {
    const { db } = buildDb({ report: REPORT })
    expect(
      await getAdditionalDetail(db, 'f-1', YEAR, MISSING_LINE_ID)
    ).toBeNull()
  })

  it('joins the method description and returns the shaped release', async () => {
    const { db, reportsFindOne, methodsFindOne, reasonsFindOne } = buildDb({
      report: REPORT,
      method: METHOD
    })

    const dto = await getAdditionalDetail(db, 'f-1', YEAR, AIR_LINE_ID)

    expect(reportsFindOne).toHaveBeenCalledWith(
      { internalFacilityId: 'f-1', reportingYear: YEAR },
      expect.any(Object)
    )
    expect(methodsFindOne).toHaveBeenCalledWith(
      { _id: 'M_WEIGH' },
      expect.any(Object)
    )
    // No reason code on this line, so no confidentiality lookup.
    expect(reasonsFindOne).not.toHaveBeenCalled()
    expect(dto.methodDescription).toBe('Measurement by weighing.')
  })

  it('joins confidential_reasons when the line carries a reason code', async () => {
    const { db, reasonsFindOne } = buildDb({
      report: REPORT,
      method: METHOD,
      reason: REASON
    })

    const dto = await getAdditionalDetail(db, 'f-1', YEAR, WASTE_LINE_ID)

    expect(reasonsFindOne).toHaveBeenCalledWith(
      { _id: 'A42d' },
      expect.any(Object)
    )
    expect(dto.confidentiality.name).toBe(
      'Article 4(2)(d) of Directive 2003/4/EC'
    )
  })
})
