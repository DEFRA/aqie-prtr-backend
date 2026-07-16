import Boom from '@hapi/boom'
import Joi from 'joi'

import { createLogger } from '#src/common/helpers/logging/logger.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { getAdditionalDetail } from '#src/services/additional-detail-service.js'

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
    .required(),
  lineId: Joi.number()
    .integer()
    .required()
    .description('ricardoReleaseTransferId of the release/transfer/waste line')
})

export async function handleAdditionalDetail(request, h) {
  const { id, year, lineId } = request.params

  try {
    const detail = await getAdditionalDetail(
      request.db,
      id,
      Number(year),
      Number(lineId)
    )

    if (!detail) {
      return Boom.notFound('Release, transfer or waste line not found')
    }

    return h.response(detail).code(statusCodes.ok)
  } catch (error) {
    logger.error(
      `[additional-detail] failed id=${id} year=${year} line=${lineId}: ${error.message}`
    )
    if (Boom.isBoom(error)) {
      throw error
    }
    throw Boom.internal('Unable to retrieve additional detail')
  }
}

export const additionalDetail = [
  {
    method: 'GET',
    path: '/facilities/{id}/record/{year}/lines/{lineId}',
    options: {
      tags: ['api', 'facilities'],
      description:
        'Additional detail of one release, transfer or waste-transfer line.',
      validate: { params: paramsSchema }
    },
    handler: handleAdditionalDetail
  }
]
