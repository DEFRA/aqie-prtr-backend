/**
 * Field-based facility search (by name, region/county, river basin or year).
 * Separate from the geo (nearby) search; returns the same result shape so the
 * frontend list + pagination are reused unchanged.
 */

const NAME = 'name'
const REGION = 'region'
const RIVER_BASIN = 'river-basin'
const YEAR = 'year'
const DECIMAL = 10
const NO_MATCH = { _id: null }

/** Escape regex metacharacters so user input can't inject a pattern (ReDoS-safe). */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildFilter(searchType, term) {
  const pattern = new RegExp(escapeRegex(term), 'i')

  switch (searchType) {
    case NAME:
      return { facilityName: pattern }
    case REGION:
      return {
        $or: [{ 'address.countyName': pattern }, { nutsRegionName: pattern }]
      }
    case RIVER_BASIN:
      return { riverBasinDistrictName: pattern }
    case YEAR: {
      const year = Number.parseInt(term, DECIMAL)
      return Number.isInteger(year) ? { reportingYears: year } : NO_MATCH
    }
    default:
      return NO_MATCH
  }
}

const PROJECTION = {
  _id: 0,
  id: '$internalFacilityId',
  name: '$facilityName',
  activity: '$mainPrtrActivityName',
  latestReportingYear: 1,
  latestReportingTypes: 1
}

/**
 * Search facilities by a field, paginated.
 *
 * @param {import('mongodb').Db} db
 * @param {{ searchType: string, term: string, skip: number, limit: number }} params
 * @returns {Promise<{ results: object[], total: number }>}
 */
export async function searchFacilities(db, { searchType, term, skip, limit }) {
  const filter = buildFilter(searchType, term)
  const collection = db.collection('facilities')

  const [total, results] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter)
      .project(PROJECTION)
      .sort({ facilityName: 1 })
      .skip(skip)
      .limit(limit)
      .toArray()
  ])

  return { results, total }
}
