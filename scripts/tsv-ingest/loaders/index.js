/**
 * Loader registry.
 *
 * Runtime order is controlled by `meta.order` on each loader, NOT by filename.
 * Filenames are simply alphabetical for easy navigation.
 *
 * Current orders:
 *   10–23 — reference collections (no upstream dependencies)
 *   25    — in-memory helper (no MongoDB collection)
 *   30–32 — core data + precompute
 */

import * as agencies from './agencies.js'
import * as regulatoryAuthorities from './regulatory-authorities.js'
import * as pollutants from './pollutants.js'
import * as naceCodes from './nace.js'
import * as nutsRegions from './nuts.js'
import * as activities from './activities.js'
import * as riverBasinDistricts from './river-basins.js'
import * as counties from './counties.js'
import * as countries from './countries.js'
import * as methods from './methods.js'
import * as releaseTransferTypes from './release-transfer-types.js'
import * as confidentialReasons from './confidential-reasons.js'
import * as methodologyNotes from './methodology-notes.js'
import * as reports from './reports.js'
import * as postcodeMap from './postcode-map.js'
import * as facilities from './facilities.js'
import * as facilityReports from './facility-reports.js'
import * as facilityLatestSummary from './facility-latest-summary.js'

export const LOADERS = [
  agencies,
  regulatoryAuthorities,
  pollutants,
  naceCodes,
  nutsRegions,
  activities,
  riverBasinDistricts,
  counties,
  countries,
  methods,
  releaseTransferTypes,
  confidentialReasons,
  methodologyNotes,
  reports,
  postcodeMap,
  facilities,
  facilityReports,
  facilityLatestSummary
].sort((a, b) => a.meta.order - b.meta.order)
