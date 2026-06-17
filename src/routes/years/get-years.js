/**
 * Get all years
 */

import { getYears as getYearsController } from '../../controllers/years-controller.js'
import { config } from '#src/config.js'
import { countBucketObjects } from '../../services/s3-service.js'
import { statusCodes } from '../../common/constants/status-codes.js'

const createErrorResponse = (h, message, error) =>
  h.response({ success: false, message, error }).code(statusCodes.internalServerError)

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
      request.log(['error', 's3'], error.message)
      return createErrorResponse(h, 'S3 service unavailable', error.message)
    }

    // Validate database is available, if so fetch years from database
    if (!request.db) {
      return createErrorResponse(h, 'Server configuration error', 'Database not available')
    }

    try {
      const result = await getYearsController(request.db, request.logger)
      return h.response(result).code(statusCodes.ok)
    } catch (error) {
      return createErrorResponse(h, 'Failed to fetch years', error.message)
    }
  }
}
