import Boom from '@hapi/boom'
import Joi from 'joi'

import { createLogger } from '#src/common/helpers/logging/logger.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { getFacilityDetails } from '#src/services/facility-details-service.js'

const logger = createLogger()
const INTERNAL_ID_PATTERN = /^f-[0-9a-f]{32}$/

const paramsSchema = Joi.object({
  id: Joi.string()
    .pattern(INTERNAL_ID_PATTERN)
    .required()
    .description('internalFacilityId')
})

export async function handleFacilityDetails(request, h) {
  const { id } = request.params

  try {
    const details = await getFacilityDetails(request.db, id)
    if (!details) {
      return Boom.notFound('Facility not found')
    }
    return h.response(details).code(statusCodes.ok)
  } catch (error) {
    logger.error(`[facility-details] failed id=${id}: ${error.message}`)
    if (Boom.isBoom(error)) {
      throw error
    }
    throw Boom.internal('Unable to retrieve facility details')
  }
}

export const facilityDetails = [
  {
    method: 'GET',
    path: '/facilities/{id}/details',
    options: {
      tags: ['api', 'facilities'],
      description:
        "A facility's reference details (address, NACE, NUTS, river basin).",
      validate: { params: paramsSchema }
    },
    handler: handleFacilityDetails
  }
]
