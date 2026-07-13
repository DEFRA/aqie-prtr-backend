import Boom from '@hapi/boom'
import Joi from 'joi'

import { createLogger } from '#src/common/helpers/logging/logger.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { getCompetentAuthority } from '#src/services/competent-authority-service.js'

const logger = createLogger()
const INTERNAL_ID_PATTERN = /^f-[0-9a-f]{32}$/

const paramsSchema = Joi.object({
  id: Joi.string()
    .pattern(INTERNAL_ID_PATTERN)
    .required()
    .description('internalFacilityId')
})

export async function handleCompetentAuthority(request, h) {
  const { id } = request.params

  try {
    const authority = await getCompetentAuthority(request.db, id)
    if (!authority) {
      return Boom.notFound('Facility not found')
    }
    return h.response(authority).code(statusCodes.ok)
  } catch (error) {
    logger.error(`[competent-authority] failed id=${id}: ${error.message}`)
    if (Boom.isBoom(error)) throw error
    throw Boom.internal('Unable to retrieve competent authority')
  }
}

export const competentAuthority = [
  {
    method: 'GET',
    path: '/facilities/{id}/competent-authority',
    options: {
      tags: ['api', 'facilities'],
      description:
        "A facility's latest competent authority and contact details (year-independent).",
      validate: { params: paramsSchema }
    },
    handler: handleCompetentAuthority
  }
]
