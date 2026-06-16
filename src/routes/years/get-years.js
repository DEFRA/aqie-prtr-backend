/**
 * Get all years with download links
 */

import { getYears as getYearsController } from '../../controllers/years-controller.js'
import { config } from '#src/config.js'
import { countBucketObjects } from '../../services/s3-service.js'
import { statusCodes } from '../../common/constants/status-codes.js'

export const getYears = {
  method: 'GET',
  path: '/years',
  options: {
    tags: ['api', 'years'],
    description: 'Get all years with download links',
    notes: 'Returns a list of all years with their associated download links'
  },
  handler: async (request, h) => {
    const bucketName = config.get('s3.bucket')
    const prefix = 'reports/'

    try {
      // Verify S3 connection is available and contains files
      const fileCount = await countBucketObjects(bucketName, prefix)
      request.log(
        ['info', 's3'],
        `S3 connection OK (${bucketName}). Files found: ${fileCount}`
      )
    } catch (error) {
      request.log(['error', 's3'], error.message)
      request.log(['info', 's3'], 'Continuing with DB years fetch')
    }

    try {
      const result = await getYearsController(request.db, request.logger)
      return h.response(result).code(statusCodes.ok)
    } catch (error) {
      return h
        .response({
          success: false,
          message: 'Failed to fetch years',
          error: error.message
        })
        .code(statusCodes.internalServerError)
    }
  }
}
