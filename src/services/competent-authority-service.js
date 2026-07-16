/**
 * Competent authority for a facility.
 *
 * The register always shows the LATEST competent authority for a facility,
 * regardless of which reporting year the user is viewing. Contact details are
 * only carried on the report documents (the facility document holds just the
 * authority/agency names), so we take them from the most recent report that
 * actually has a contact block, and fall back to the facility's own authority.
 */

const EMPTY = {}

function resolveAuthority(facility, report) {
  return report?.competentAuthority ?? facility.competentAuthority ?? EMPTY
}

function toAuthorityNames(authority) {
  return {
    name: authority.regulatoryAuthority?.name ?? null,
    agency: authority.agency?.acronym ?? null
  }
}

function toContactDetails(contact) {
  return {
    contactPersonName: contact.contactPersonName ?? null,
    telephone: contact.telephone ?? null,
    fax: contact.fax ?? null,
    email: contact.email ?? null
  }
}

function toAddress(address) {
  return {
    street: address.streetName ?? null,
    building: address.buildingNumber ?? null,
    city: address.cityName ?? null,
    postcode: address.postcodeCode ?? null
  }
}

/**
 * Shape a facility + its latest CA-bearing report into the page DTO.
 * Pure — exported for unit testing.
 */
export function toCompetentAuthority(facility, report) {
  const authority = resolveAuthority(facility, report)
  const contact = authority.contact ?? EMPTY

  return {
    facilityId: facility.internalFacilityId,
    facilityName: facility.facilityName,
    sourceYear: report?.reportingYear ?? null,
    ...toAuthorityNames(authority),
    ...toContactDetails(contact),
    address: contact.address ? toAddress(contact.address) : null
  }
}

/**
 * Fetch a facility's latest competent authority.
 *
 * @param {import('mongodb').Db} db
 * @param {string} internalFacilityId
 * @returns {Promise<object|null>} null when the facility does not exist
 */
export async function getCompetentAuthority(db, internalFacilityId) {
  const facility = await db.collection('facilities').findOne(
    { internalFacilityId },
    {
      projection: {
        _id: 0,
        internalFacilityId: 1,
        facilityName: 1,
        competentAuthority: 1
      }
    }
  )

  if (!facility) {
    return null
  }

  // Most recent report that carries contact details. Served by the existing
  // { internalFacilityId, reportingYear } index; a facility has ~18 reports at most.
  const report = await db.collection('facility_reports').findOne(
    { internalFacilityId, 'competentAuthority.contact': { $ne: null } },
    {
      projection: { _id: 0, reportingYear: 1, competentAuthority: 1 },
      sort: { reportingYear: -1 }
    }
  )

  return toCompetentAuthority(facility, report)
}
