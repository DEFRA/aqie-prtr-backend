/**
 * Loader Precompute facility list-page fields
 *
 * the following fields on facilities are derived
 * from facilityReports at ingest end:
 *   - latestReportingYear
 *   - latestReportingTypes ["pollutantReleases" | "pollutantTransfers" | "wasteTransfers"]
 *   - reportingYears (sorted array of all years this facility reports in)
 *   - mainPrtrActivityCode + mainPrtrActivityName (from latest year's activities)
 *   - mainIppcActivityCode + mainIppcActivityName
 */

import { loaderLogger } from '../lib/logger.js'
import { config } from '../config.js'
import { db } from '../lib/mongo.js'

export const meta = {
  name: 'facilityLatestSummary',
  phase: 'core',
  order: 32,
  sourceTsvs: [],
  targetCollection: 'facilities' // updates this collection in place
}

export async function run() {
  const log = loaderLogger(meta.name)

  // Aggregate per-facility summary from facilityReports
  const pipeline = [
    {
      $project: {
        internalFacilityId: 1,
        reportingYear: 1,
        hasReleases: {
          $gt: [{ $size: { $ifNull: ['$pollutantReleases', []] } }, 0]
        },
        hasTransfers: {
          $gt: [{ $size: { $ifNull: ['$pollutantTransfers', []] } }, 0]
        },
        hasWaste: { $gt: [{ $size: { $ifNull: ['$wasteTransfers', []] } }, 0] },
        activities: 1
      }
    },
    {
      $group: {
        _id: '$internalFacilityId',
        reportingYears: { $addToSet: '$reportingYear' },
        latestYear: { $max: '$reportingYear' },
        // capture each year's flags + activities to find the LATEST year's data
        perYear: {
          $push: {
            year: '$reportingYear',
            hasReleases: '$hasReleases',
            hasTransfers: '$hasTransfers',
            hasWaste: '$hasWaste',
            activities: '$activities'
          }
        }
      }
    }
  ]

  let updates = []
  let processed = 0
  async function flushUpdates() {
    if (updates.length === 0) return
    if (config.dryRun) {
      updates = []
      return
    }
    await db().collection('facilities').bulkWrite(updates, { ordered: false })
    updates = []
  }

  const cursor = db().collection('facility_reports').aggregate(pipeline)
  for await (const summary of cursor) {
    const internalFacilityId = summary._id
    const latestYear = summary.latestYear
    const sortedYears = [...summary.reportingYears].sort((a, b) => a - b)

    const latest = summary.perYear.find((y) => y.year === latestYear) ?? {}
    const latestTypes = []
    if (latest.hasReleases) latestTypes.push('pollutantReleases')
    if (latest.hasTransfers) latestTypes.push('pollutantTransfers')
    if (latest.hasWaste) latestTypes.push('wasteTransfers')

    // Main IPPC + PRTR activities from latest year (isMainActivity=true preferred, fall back to first)
    const activities = latest.activities ?? []
    const mainPrtr =
      activities.find((a) => a.taxonomy === 'prtr' && a.isMainActivity) ??
      activities.find((a) => a.taxonomy === 'prtr')
    const mainIppc =
      activities.find((a) => a.taxonomy === 'ippc' && a.isMainActivity) ??
      activities.find((a) => a.taxonomy === 'ippc')

    updates.push({
      updateOne: {
        filter: { internalFacilityId },
        update: {
          $set: {
            latestReportingYear: latestYear,
            latestReportingTypes: latestTypes,
            reportingYears: sortedYears,
            mainPrtrActivityCode: mainPrtr?.activityCode ?? null,
            mainPrtrActivityName: mainPrtr?.name ?? null,
            mainIppcActivityCode: mainIppc?.activityCode ?? null,
            mainIppcActivityName: mainIppc?.name ?? null,
            updatedAt: new Date()
          }
        }
      }
    })
    processed++
    if (updates.length >= config.batchSize) await flushUpdates()
  }
  await flushUpdates()

  log.info(
    { facilitiesUpdated: processed },
    'facility latest-summary precomputation complete'
  )
  return { count: processed }
}
