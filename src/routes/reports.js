/**
 * Reports routes: fetch all reports and get presigned download links
 */

import Boom from '@hapi/boom'
import Joi from 'joi'

import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'
import {
  getReports as getReportsController,
  ReportsBackendError
} from '#src/services/reports-service.js'
import {
  countBucketObjects,
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

/**
 * Generate a presigned download link for a report for a specific year.
 * Maps S3 service failures to a clean 502 response.
 *
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
export async function handleDownloadLink(request, h) {
  const { year } = request.params

  try {
    const presignedUrl = await generatePresignedReportDownloadLink(
      config.get('s3.bucket'),
      year
    )
    logger.info(`[get-download-link.search] succeeded for year=${year}`)
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

export const reports = [
  {
    method: 'GET',
    path: '/reports',
    options: {
      tags: ['api', 'reports'],
      description:
        'Verifies S3 connection health, then retrieves all reports from the database'
    },
    handler: handleGetReports
  },
  {
    method: 'GET',
    path: '/reports/get-download-link/{year}',
    options: {
      tags: ['api', 'download-links'],
      description:
        'Get a presigned download link for a report for a specific year',
      validate: { params: paramsSchema }
    },
    handler: handleDownloadLink
  }
]
