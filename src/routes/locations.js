import Boom from '@hapi/boom'
import Joi from 'joi'

import { config } from '#src/config.js'
import {
  searchLocation,
  LocationBackendError
} from '#src/services/location-service.js'
import { mapLocationResponse } from '#src/services/location-mapper.js'

const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 100

export const locations = [
  {
    method: 'GET',
    path: '/locations/search',
    options: {
      tags: ['api', 'locations'],
      description: 'Search for UK place names and postcodes via aqie-location-backend.',
      validate: {
        query: Joi.object({
          q: Joi.string()
            .trim()
            .min(MIN_QUERY_LENGTH)
            .max(MAX_QUERY_LENGTH)
            .required()
            .description('Postcode, town, or place name. Min 2, max 100 chars.')
        })
      }
    },
    handler: async (request, h) => {
      const { q } = request.query
      const traceId = request.headers[config.get('tracing.header')]

      try {
        const data = await searchLocation(q, { traceId })
        return h.response(mapLocationResponse(q,data)).code(200)
      } catch (err) {
        if (err instanceof LocationBackendError) {
          request.logger.error(
            { err, q, upstreamStatus: err.status },
            'Location backend call failed'
          )
          return Boom.badGateway('Location service is currently unavailable')
        }
        throw err
      }
    }
  }
]
