/**
 * Get all years with download links
 */

import { getYears as getYearsController } from '../../controllers/years-controller.js'

export const getYears = {
  method: 'GET',
  path: '/years',
  options: {
    tags: ['api', 'years'],
    description: 'Get all years with download links',
    notes: 'Returns a list of all years with their associated download links'
  },
  handler: async (request, h) => {
    try {
      const result = await getYearsController(request.db, request.logger)
      return h.response(result).code(200)
    } catch (error) {
      return h
        .response({
          success: false,
          message: 'Failed to fetch years',
          error: error.message
        })
        .code(500)
    }
  }
}
