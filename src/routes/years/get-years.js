/**
 * Fetch all years with S3 health check
 */

import Boom from '@hapi/boom'

import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'
import {
  getYears as getYearsController,
  YearsBackendError
} from '#src/services/years-service.js'
import { countBucketObjects, S3BackendError } from '#src/services/s3-service.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

const logger = createLogger()

/**
 * Get all years, verifying S3 connection health and querying the database.
 * Checks both S3 bucket connectivity and retrieves years from the database.
 *
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
export async function handleGetYears(request, h) {
  const bucketName = config.get('s3.bucket')
  const prefix = 'reports/'

  try {
    // Check S3 health
    const fileCount = await countBucketObjects(bucketName, prefix)
    logger.info(
      `[get-years.search] S3 connection OK (${bucketName}). Files found: ${fileCount}`
    )

    // Fetch years from database
    const result = await getYearsController(request.db, logger)
    logger.info(
      `[get-years.search] succeeded, count=${result.count}`
    )
    return h.response(result).code(statusCodes.ok)
  } catch (error) {
    if (error instanceof S3BackendError) {
      logger.error(
        `[get-years.search] S3 backend failed: ${error.message}`
      )
      return Boom.badGateway('S3 service is currently unavailable')
    }
    if (error instanceof YearsBackendError) {
      logger.error(
        `[get-years.search] database backend failed: ${error.message}`
      )
      return Boom.badGateway('Years service is currently unavailable')
    }
    logger.error(
      `[get-years.search] unexpected error: ${error.message}`
    )
    throw error
  }
}

export const getYears = {
  method: 'GET',
  path: '/years',
  options: {
    tags: ['api', 'years'],
    description: 'Verifies S3 connection health, then retrieves all years from the database',
  },
  handler: handleGetYears
}
