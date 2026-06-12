/**
 * Generate download links for year
 */

import { config } from '#src/config.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { getDownloadLinkAndSaveToDB } from '#src/services/s3-service.js'

export const generateDownloadLink = {
  method: 'POST',
  path: '/years/generate-download-link/{year}',
  options: {
    tags: ['api', 'download-links'],
    description: 'Generate download link for a specific year',
    notes: 'Generates download link for a specific year'
  },
  handler: async (request, h) => {
    const { year } = request.params

    try {
      await getDownloadLinkAndSaveToDB(
        request.db,
        config.get('s3.bucket'),
        year
      )

      request.log(
        ['info', 'download-links'],
        `Generated download link for year ${year}`
      )

      return h
        .response({
          success: true,
          message: `Download link for year ${year} generated successfully`
        })
        .code(statusCodes.ok)
    } catch (error) {
      return h
        .response({
          success: false,
          message: `Failed to generate download link for year ${year}`,
          error: error.message
        })
        .code(statusCodes.internalServerError)
    }
  }
}
