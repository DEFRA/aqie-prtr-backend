import exampleReports from '../data/example-reports.json'
/**
 * Thrown when database operations fail (connection, invalid query, etc).
 * Lets routes map failures to appropriate HTTP status codes.
 */
export class ReportsBackendError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'ReportsBackendError'
    this.status = status ?? null
    if (cause) {
      this.cause = cause
    }
  }
}

/**
 * Fetch all reports from the database, sorted by year descending.
 *
 * @param {object} db - MongoDB database instance
 * @param {object} logger - Logger instance
 * @returns {Promise<{count: number, results: object[]}>} Reports with metadata
 * @throws {ReportsBackendError}
 */
async function getReports(_db, logger) {
  //async function getReports(db, logger) {
  try {
    // Database query code - kept for future use
    // const reportsCollection = db.collection('Reports')
    // const reports = await reportsCollection
    //   .find({})
    //   .sort({ year: -1 })
    //   .toArray()

    // For now, use example reports from JSON file instead
    // To switch back to database, delete the line below and uncomment the lines above
    const reports = exampleReports

    return {
      count: reports.length,
      results: reports.map((doc) => ({
        id: doc.reportID,
        year: doc.year,
        reportIsLive: doc.reportIsLive
      }))
    }
  } catch (error) {
    logger.error(error, 'Failed to fetch reports')
    throw new ReportsBackendError(`Failed to fetch reports: ${error.message}`, {
      cause: error
    })
  }
}

export { getReports }
