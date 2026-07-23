import { health } from '#src/routes/health.js'
import { locations } from '#src/routes/locations.js'
import { facilities } from '#src/routes/facilities.js'
import { reports } from '#src/routes/reports.js'
import { facilityRecord } from '#src/routes/facility-record.js'
import { facilityDetails } from '#src/routes/facility-details.js'
import { competentAuthority } from '#src/routes/competent-authority.js'
import { additionalDetail } from '../routes/additional-detail.js'
import { facilitySearch } from '#src/routes/facility-search.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([
        health,
        ...locations,
        ...facilities,
        ...reports,
        ...facilityRecord,
        ...facilityDetails,
        ...competentAuthority,
        ...additionalDetail,
        ...facilitySearch
      ])
    }
  }
}
