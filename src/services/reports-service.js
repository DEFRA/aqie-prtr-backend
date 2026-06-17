/**
 * Thrown when database operations fail (connection, invalid query, etc).
 * Lets routes map failures to appropriate HTTP status codes.
 */
export class ReportsBackendError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'ReportsServiceError'
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
async function getReports(db, logger) {
  try {
    const reportsCollection = db.collection('Reports')
    const reports = await reportsCollection
      .find({})
      .sort({ year: -1 })
      .toArray()
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
