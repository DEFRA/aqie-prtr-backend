/**
 * Fetch all reports with S3 health check
 */

import Boom from '@hapi/boom'

import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'
import {
  getReports as getReportsController,
  ReportsBackendError
} from '#src/services/reports-service.js'
import { countBucketObjects, S3BackendError } from '#src/services/s3-service.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

const logger = createLogger()

/**
 * Get all reports, verifying S3 connection health and querying the database.
 * Checks both S3 bucket connectivity and retrieves reports from the database.
 *
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
export async function handleGetReports(request, h) {
  const bucketName = config.get('s3.bucket')
  const prefix = 'reports/'

  try {
    // Check S3 health
    const fileCount = await countBucketObjects(bucketName, prefix)
    logger.info(
      `[get-reports.search] S3 connection OK (${bucketName}). Files found: ${fileCount}`
    )

    // Fetch reports from database
    const result = await getReportsController(request.db, logger)
    logger.info(`[get-reports.search] succeeded, count=${result.count}`)
    return h.response(result).code(statusCodes.ok)
  } catch (error) {
    if (error instanceof S3BackendError) {
      logger.error(`[get-reports.search] S3 backend failed: ${error.message}`)
      return Boom.badGateway('S3 service is currently unavailable')
    }
    if (error instanceof ReportsBackendError) {
      logger.error(
        `[get-reports.search] database backend failed: ${error.message}`
      )
      return Boom.badGateway('Reports service is currently unavailable')
    }
    logger.error(`[get-reports.search] unexpected error: ${error.message}`)
    throw error
  }
}

export const getReports = {
  method: 'GET',
  path: '/reports',
  options: {
    tags: ['api', 'reports'],
    description:
      'Verifies S3 connection health, then retrieves all reports from the database'
  },
  handler: handleGetReports
}
