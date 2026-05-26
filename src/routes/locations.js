import Boom from '@hapi/boom'
import Joi from 'joi'

import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'
import {
  searchLocation,
  LocationBackendError
} from '#src/services/location-service.js'
import { mapLocationResponse } from '#src/services/location-mapper.js'

const logger = createLogger()

const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 100

const querySchema = Joi.object({
  q: Joi.string()
    .trim()
    .min(MIN_QUERY_LENGTH)
    .max(MAX_QUERY_LENGTH)
    .required()
    .description('Postcode, town, or place name. Min 2, max 100 chars.')
})

/**
 * Resolve a town/postcode string to candidate locations via aqie-location-backend.
 * Maps the raw OS Names response to the BFF's clean public shape.
 *
 * @param {import('@hapi/hapi').Request} request
 * @param {import('@hapi/hapi').ResponseToolkit} h
 */
export async function handleLocationsSearch(request, h) {
  const { q } = request.query
  const traceId = request.headers[config.get('tracing.header')]

  try {
    const raw = await searchLocation(q, { traceId })
    const mapped = mapLocationResponse(q, raw)
    logger.info(
      `[locations.search] succeeded for q="${q}" count=${mapped.count}`
    )
    return h.response(mapped).code(200)
  } catch (error) {
    if (error instanceof LocationBackendError) {
      logger.error(
        `[locations.search] upstream failed for q="${q}" status=${error.status}: ${error.message}`
      )
      return Boom.badGateway('Location service is currently unavailable')
    }
    logger.error(
      `[locations.search] unexpected error for q="${q}": ${error.message}`
    )
    throw error
  }
}

export const locations = [
  {
    method: 'GET',
    path: '/locations/search',
    options: {
      tags: ['api', 'locations'],
      description: 'Search for UK place names and postcodes via aqie-location-backend.',
      validate: { query: querySchema }
    },
    handler: handleLocationsSearch
  }
]
