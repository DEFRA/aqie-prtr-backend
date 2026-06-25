import exampleReports from '../data/example-reports.js'
import {
  generatePresignedReportDownloadLink,
  findKeyByMetadataFilename,
  S3BackendError
} from './s3-service.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'

const logger = createLogger()

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
 * @returns {Promise<{count: number, results: object[]}>} Reports with metadata
 * @throws {ReportsBackendError}
 */
async function getReports(_db) {
  //async function getReports(db) {
  try {
    // Database query code - kept for future use
    // const reportsCollection = db.collection('Reports')
    // const reports = await reportsCollection
    //   .find({})
    //   .sort({ year: 1 })
    //   .toArray()

    // For now, use example reports from JSON file instead
    // To switch back to database, delete the line below and uncomment the lines above
    const reports = exampleReports.reports

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

/**
 * Get a presigned download link for a report by year.
 *
 * Strategy:
 * 1. Search S3 metadata to find the S3 key for the year
 * 2. Generate and return a presigned download URL
 *
 * @param {number} year - Year of the report
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<string>} - Presigned download URL
 * @throws {ReportsBackendError|S3BackendError}
 */
export async function getReportDownloadLink(year, bucketName) {
  try {
    // Search S3 by metadata to find the S3 key
    logger.info(
      `[get-report-download] Searching S3 metadata for year=${year}...`
    )
    const s3Key = await findKeyByMetadataFilename(bucketName, year)
    logger.info(`[get-report-download] Found S3 key in S3 for year=${year}`)

    // Generate presigned URL
    const presignedUrl = await generatePresignedReportDownloadLink(
      bucketName,
      s3Key,
      year
    )

    return presignedUrl
  } catch (error) {
    if (error instanceof S3BackendError) {
      throw error
    }
    logger.error(error, `Failed to get download link for year=${year}`)
    throw new ReportsBackendError(
      `Failed to get download link for year=${year}: ${error.message}`,
      { cause: error }
    )
  }
}

export { getReports }
