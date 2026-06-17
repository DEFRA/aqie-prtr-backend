/**
 * Thrown when database operations fail (connection, invalid query, etc).
 * Lets routes map failures to appropriate HTTP status codes.
 */
export class YearsBackendError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'YearsServiceError'
    this.status = status ?? null
    if (cause) {
      this.cause = cause
    }
  }
}

/**
 * Fetch all years from the database, sorted by year descending.
 *
 * @param {object} db - MongoDB database instance
 * @param {object} logger - Logger instance
 * @returns {Promise<{count: number, results: object[]}>} Years with metadata
 * @throws {YearsBackendError}
 */
async function getYears(db, logger) {
  try {
    const yearsCollection = db.collection('Years')
    const years = await yearsCollection.find({}).sort({ year: -1 }).toArray()
    return {
      count: years.length,
      results: years.map((doc) => ({
        id: doc.yearID,
        year: doc.year,
        yearIsLive: doc.yearIsLive
      }))
    }
  } catch (error) {
    logger.error(error, 'Failed to fetch years')
    throw new YearsBackendError(
      `Failed to fetch years: ${error.message}`,
      { cause: error }
    )
  }
}

export { getYears }
