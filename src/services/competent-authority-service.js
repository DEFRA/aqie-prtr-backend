/**
 * Competent authority for a facility.
 *
 * The register always shows the LATEST competent authority for a facility,
 * regardless of which reporting year the user is viewing. Contact details are
 * only carried on the report documents (the facility document holds just the
 * authority/agency names), so we take them from the most recent report that
 * actually has a contact block, and fall back to the facility's own authority.
 */

/**
 * Shape a facility + its latest CA-bearing report into the page DTO.
 * Pure — exported for unit testing.
 */
export function toCompetentAuthority(facility, report) {
  const authority =
    report?.competentAuthority ?? facility.competentAuthority ?? null
  const contact = authority?.contact ?? null
  const address = contact?.address ?? null

  return {
    facilityId: facility.internalFacilityId,
    facilityName: facility.facilityName,
    // Which year the details were taken from — useful for support/debugging.
    sourceYear: report?.reportingYear ?? null,
    name: authority?.regulatoryAuthority?.name ?? null,
    agency: authority?.agency?.acronym ?? null,
    contactPersonName: contact?.contactPersonName ?? null,
    address: address
      ? {
          street: address.streetName ?? null,
          building: address.buildingNumber ?? null,
          city: address.cityName ?? null,
          postcode: address.postcodeCode ?? null
        }
      : null,
    telephone: contact?.telephone ?? null,
    fax: contact?.fax ?? null,
    email: contact?.email ?? null
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
