import Boom from '@hapi/boom'
import Joi from 'joi'

import { createLogger } from '#src/common/helpers/logging/logger.js'
import { findFacilitiesNearby } from '#src/services/facility-service.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

const logger = createLogger()

const DEFAULT_PER_PAGE = 10
const MAX_PER_PAGE = 100
const DEFAULT_RADIUS_MILES = 50
const MAX_RADIUS_MILES = 50

const querySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number()
    .min(1)
    .max(MAX_RADIUS_MILES)
    .default(DEFAULT_RADIUS_MILES),
  page: Joi.number().integer().min(1).default(1),
  perPage: Joi.number()
    .integer()
    .min(1)
    .max(MAX_PER_PAGE)
    .default(DEFAULT_PER_PAGE)
})

export async function handleFacilitiesNearby(request, h) {
  const { lat, lng, radius, page, perPage } = request.query

  try {
    const { results, total } = await findFacilitiesNearby(request.db, {
      lat,
      lng,
      radiusMiles: radius,
      skip: (page - 1) * perPage,
      limit: perPage
    })
    logger.info(
      `[facilities.nearby] lat=${lat} lng=${lng} radius=${radius} page=${page} total=${total}`
    )
    return h
      .response({
        count: results.length,
        total,
        page,
        perPage,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
        results
      })
      .code(statusCodes.ok)
  } catch (error) {
    logger.error(
      `[facilities.nearby] failed lat=${lat} lng=${lng}: ${error.message}`
    )
    if (Boom.isBoom(error)) throw error
    throw Boom.internal('Unable to retrieve facilities')
  }
}

export const facilities = [
  {
    method: 'GET',
    path: '/facilities/nearby',
    options: {
      tags: ['api', 'facilities'],
      description: 'List facilities near a location, nearest first, paginated.',
      validate: { query: querySchema }
    },
    handler: handleFacilitiesNearby
  }
]
