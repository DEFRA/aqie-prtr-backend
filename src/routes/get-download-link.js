/**
 * Get presigned download link for the report for a specific year
 */

import Boom from '@hapi/boom'
import Joi from 'joi'

import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'
import {
  generatePresignedReportDownloadLink,
  S3BackendError
} from '#src/services/s3-service.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

const logger = createLogger()

const MIN_YEAR = 2007

const paramsSchema = Joi.object({
  year: Joi.number()
    .integer()
    .min(MIN_YEAR)
    .max(new Date().getFullYear())
    .required()
    .description('Year of the report to download')
})

/**
 * Generate a presigned download link for a report for a specific year.
 * Maps S3 service failures to a clean 502 response.
 *
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
export async function handleGetDownloadLink(request, h) {
  const { year } = request.params

  try {
    const presignedUrl = await generatePresignedReportDownloadLink(
      config.get('s3.bucket'),
      year
    )
    logger.info(
      `[get-download-link.search] succeeded for year=${year}`
    )
    return h
      .response({
        downloadLink: presignedUrl
      })
      .code(statusCodes.ok)
  } catch (error) {
    if (error instanceof S3BackendError) {
      logger.error(
        `[get-download-link.search] S3 backend failed for year=${year}: ${error.message}`
      )
      return Boom.badGateway('S3 service is currently unavailable')
    }
    logger.error(
      `[get-download-link.search] unexpected error for year=${year}: ${error.message}`
    )
    throw error
  }
}

export const getDownloadLink = {
  method: 'GET',
  path: '/reports/get-download-link/{year}',
  options: {
    tags: ['api', 'download-links'],
    description: 'Get a presigned download link for a report for a specific year',
    validate: { params: paramsSchema }
  },
  handler: handleGetDownloadLink
}
