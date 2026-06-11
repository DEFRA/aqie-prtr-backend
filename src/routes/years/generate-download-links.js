/**
 * Post months data
 */

import { config } from '#src/config.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { getDownloadLinksAndSaveToDB } from '#src/services/s3-service.js'

export const generateDownloadLinks = {
  method: 'POST',
  path: '/years/generate-download-links',
  options: {
    tags: ['api', 'download-links'],
    description: 'Generate download links for years',
    notes: 'Generates download links for years'
  },
  handler: async (request, h) => {
    try {
      await getDownloadLinksAndSaveToDB(
        request.db,
        config.get('s3.bucket')
      )

      request.log(
        ['info', 'download-links'],
        'Generated download links for years'
      )

      return h.response({
        success: true,
        message: 'Download links generated successfully'
      }).code(statusCodes.ok)
    } catch (error) {
      return h
        .response({
          success: false,
          message: 'Failed to generate download links',
          error: error.message
        })
        .code(statusCodes.internalServerError)
    }
  }
}