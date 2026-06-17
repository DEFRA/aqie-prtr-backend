/**
 * Get all years
 */

import Boom from '@hapi/boom'

import { getYears as getYearsController } from '../../services/years-service.js'
import { config } from '#src/config.js'
import { countBucketObjects } from '../../services/s3-service.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

const logger = createLogger()

export const getYears = {
  method: 'GET',
  path: '/years',
  options: {
    tags: ['api', 'years'],
    description: 'Verifies S3 connection health, then retrieves all years from the database',
  },
  handler: async (request, h) => {
    // Check S3 health
    const bucketName = config.get('s3.bucket')
    const prefix = 'reports/'

    try {
      const fileCount = await countBucketObjects(bucketName, prefix)
      request.log(['info', 's3'], `S3 connection OK (${bucketName}). Files found: ${fileCount}`)
    } catch (error) {
      logger.error(
        `[get-years] S3 service error: ${error.message}`
      )
      return Boom.internalServerError('S3 service is currently unavailable')
    }

    // Validate database is available, if so fetch years from database
    if (!request.db) {
      logger.error('[get-years] Database not available')
      return Boom.internalServerError('Server configuration error')
    }

    try {
      const result = await getYearsController(request.db, request.logger)
      return h.response(result).code(statusCodes.ok)
    } catch (error) {
      logger.error(
        `[get-years] failed to fetch years: ${error.message}`
      )
      return Boom.internalServerError('Failed to fetch years')
    }
  }
}
