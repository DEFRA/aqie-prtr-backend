export const METRES_PER_MILE = 1609.344

/**
 * Find facilities within `radiusMeters` of a point, nearest first, one page.
 * $geoNear must be the first stage; it adds the distance and sorts by it.
 * $facet returns the page slice and the total count in a single round-trip.
 *
 * @param {import('mongodb').Db} db
 * @param {{ lng:number, lat:number, radiusMeters:number, skip:number, limit:number }} params
 * @returns {Promise<{ results: object[], total: number }>}
 */
export async function findFacilitiesNearby(db, { lng, lat, radiusMiles, skip, limit }) {
  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMiles',
        distanceMultiplier: 1 / METRES_PER_MILE,
        maxDistance: radiusMiles * METRES_PER_MILE,
        spherical: true,
        query: {
          'location.coordinates.0': { $gte: -180, $lte: 180 },
          'location.coordinates.1': { $gte: -90, $lte: 90 }
        }
      }
    },
    {
      $facet: {
        results: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              id: '$internalFacilityId',
              name: '$facilityName',
              activity: '$mainPrtrActivityName',
              distanceMiles: { $round: ['$distanceMiles', 1] },
              latestReportingYear: 1,
              latestReportingTypes: 1
            }
          }
        ],
        totalCount: [{ $count: 'total' }]
      }
    }
  ]

  const [facet] = await db.collection('facilities').aggregate(pipeline).toArray()
  return {
    results: facet?.results ?? [],
    total: facet?.totalCount?.[0]?.total ?? 0
  }
}
