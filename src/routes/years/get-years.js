/**
 * Get all years with download links
 */

import { getYears as getYearsController } from '../../controllers/years-controller.js'
import { createLogger } from '../../common/helpers/logging/logger.js' // Using existing logger setup to test
import { config } from '#src/config.js'
import { listBucketContents } from '../../services/s3-service.js' // Using existing S3 service to test

const logger = createLogger('s3-service')

export const getYears = {
  method: 'GET',
  path: '/years',
  options: {
    tags: ['api', 'years'],
    description: 'Get all years with download links',
    notes: 'Returns a list of all years with their associated download links'
  },
  handler: async (request, h) => {
    // S3 logic - check bucket and log file count
    const bucketName = config.get('s3.bucket')
    const { prefix } = request.query

    try {
      const files = await listBucketContents(bucketName, prefix)
      logger.info(`Successfully fetched ${files.length} files from ${bucketName}`)
      request.log(
        ['info', 's3'],
        `Successfully fetched ${files.length} files from ${bucketName}`
      )
    } catch (error) {
      request.log(['error', 's3'], error.message)
      //throw error; // TODO: for now, don't want to throw here,so to continue to fetch years from DB even if S3 fails
      logger.error(
        `Failed to list S3 contents for ${bucketName}: ${error.message}. Continuing with DB years fetch.`
      )
    }

    // Get years from database
    try {
      const result = await getYearsController(request.db, request.logger)
      return h.response(result).code(200)
    } catch (error) {
      return h
        .response({
          success: false,
          message: 'Failed to fetch years',
          error: error.message
        })
        .code(500)
    }
  }
}
