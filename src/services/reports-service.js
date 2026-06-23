import exampleReports from '../data/example-reports.json'
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

/**
 * Get a presigned download link for a report by year.
 * 
 * Strategy:
 * 1. First, check if the S3 key is stored in the database (fast)
 * 2. If not found, search S3 metadata to find the key (slower, fallback)
 * 3. Generate and return a presigned download URL
 *
 * @param {object} db - MongoDB database instance
 * @param {number} year - Year of the report
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<string>} - Presigned download URL
 * @throws {ReportsBackendError|S3BackendError}
 */
export async function getReportDownloadLink(db, year, bucketName) {
  try {
    let s3Key;

    // Step 1: Try to get S3 key from database
    try {
      const reportsCollection = db.collection('Reports')
      const report = await reportsCollection.findOne({ year })
      
      if (report?.s3Key) {
        logger.info(`[get-report-download] Found S3 key in DB for year=${year}`)
        s3Key = report.s3Key
      }
    } catch (dbError) {
      logger.warn(
        `[get-report-download] Database lookup failed for year=${year}, will search S3 instead`,
        dbError.message
      )
    }

    // Step 2: If not in database, search S3 by metadata
    if (!s3Key) {
      logger.info(
        `[get-report-download] S3 key not in DB for year=${year}, searching S3 metadata...`
      )
      s3Key = await findKeyByMetadataFilename(bucketName, year)
      logger.info(`[get-report-download] Found S3 key in S3 for year=${year}`)

      // Step 2a: Save the S3 key to database for faster future lookups
      try {
        // const reportsCollection = db.collection('Reports')
        // await reportsCollection.updateOne(
        //   { year },
        //   { $set: { s3Key } },
        //   { upsert: true }
        // )
        logger.info(`[get-report-download] Cached S3 key in DB for year=${year}`)
      } catch (cacheError) {
        logger.warn(
          `[get-report-download] Failed to cache S3 key in DB for year=${year}`,
          cacheError.message
        )
        // Don't throw - continue anyway, just won't be cached
      }
    }

    // Step 3: Generate presigned URL
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
