import Boom from '@hapi/boom'
import Joi from 'joi'

import { createLogger } from '#src/common/helpers/logging/logger.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { getFacilityRecord } from '#src/services/facility-record-service.js'

const logger = createLogger()
const MIN_YEAR = 2007
const INTERNAL_ID_PATTERN = /^f-[0-9a-f]{32}$/

const paramsSchema = Joi.object({
  id: Joi.string()
    .pattern(INTERNAL_ID_PATTERN)
    .required()
    .description('internalFacilityId'),
  year: Joi.number()
    .integer()
    .min(MIN_YEAR)
    .max(new Date().getFullYear())
    .optional()
    .description('Reporting year. Defaults to the latest available.')
})

export async function handleFacilityRecord(request, h) {
  const { id } = request.params
  const year = request.params.year ? Number(request.params.year) : undefined

  try {
    const record = await getFacilityRecord(request.db, id, year)
    if (!record) {
      return Boom.notFound('Facility not found')
    }
    logger.info(`[facility-record] id=${id} year=${record.year}`)
    return h.response(record).code(statusCodes.ok)
  } catch (error) {
    logger.error(`[facility-record] failed id=${id}: ${error.message}`)
    if (Boom.isBoom(error)) {
      throw error
    }
    throw Boom.internal('Unable to retrieve facility record')
  }
}

export const facilityRecord = [
  {
    method: 'GET',
    path: '/facilities/{id}/record/{year?}',
    options: {
      tags: ['api', 'facilities'],
      description:
        "A facility's releases & transfers for a year (defaults to latest).",
      validate: { params: paramsSchema }
    },
    handler: handleFacilityRecord
  }
]
