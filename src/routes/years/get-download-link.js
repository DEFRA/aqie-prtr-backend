/**
 * Get download links for year
 */

import Boom from '@hapi/boom'

import { config } from '#src/config.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'
import { generatePresignedReportDownloadLink } from '#src/services/s3-service.js'

const logger = createLogger()

export const getDownloadLink = {
  method: 'GET',
  path: '/years/get-download-link/{year}',
  options: {
    tags: ['api', 'download-links'],
    description: 'Get download link for a specific year',
    notes: 'Get download link for a specific year'
  },
  handler: async (request, h) => {
    const { year } = request.params

    try {
      const presignedUrl = await generatePresignedReportDownloadLink(
        config.get('s3.bucket'),
        year
      )

      request.log(
        ['info', 'download-links'],
        `Retrieved download link for year ${year}`
      )

      return h
        .response({
          success: true,
          message: `Download link for year ${year} successfully retrieved`,
          downloadLink: presignedUrl
        })
        .code(statusCodes.ok)
    } catch (error) {
      logger.error(
        `[get-download-link] failed to retrieve download link for year ${year}: ${error.message}`
      )
      return Boom.internalServerError('Failed to retrieve download link')
    }
  }
}
