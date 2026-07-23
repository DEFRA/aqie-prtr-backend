import Boom from '@hapi/boom'
import Joi from 'joi'

import { createLogger } from '#src/common/helpers/logging/logger.js'
import { statusCodes } from '#src/common/constants/status-codes.js'
import { searchFacilities } from '#src/services/facility-search-service.js'

const logger = createLogger()
const DEFAULT_PER_PAGE = 10
const MAX_PER_PAGE = 100
const MIN_TERM = 1
const MAX_TERM = 100

const querySchema = Joi.object({
  searchType: Joi.string()
    .valid('name', 'region', 'river-basin', 'year')
    .required(),
  q: Joi.string().trim().min(MIN_TERM).max(MAX_TERM).required(),
  page: Joi.number().integer().min(1).default(1),
  perPage: Joi.number()
    .integer()
    .min(1)
    .max(MAX_PER_PAGE)
    .default(DEFAULT_PER_PAGE)
})

export async function handleFacilitySearch(request, h) {
  const { searchType, q, page, perPage } = request.query

  try {
    const { results, total } = await searchFacilities(request.db, {
      searchType,
      term: q,
      skip: (page - 1) * perPage,
      limit: perPage
    })
    logger.info(
      `[facilities.search] type=${searchType} q="${q}" total=${total}`
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
      `[facilities.search] failed type=${searchType} q="${q}": ${error.message}`
    )
    if (Boom.isBoom(error)) {
      throw error
    }
    throw Boom.internal('Unable to search facilities')
  }
}

export const facilitySearch = [
  {
    method: 'GET',
    path: '/facilities/search',
    options: {
      tags: ['api', 'facilities'],
      description:
        'Search facilities by name, region/county, river basin or year (paginated).',
      validate: { query: querySchema }
    },
    handler: handleFacilitySearch
  }
]
