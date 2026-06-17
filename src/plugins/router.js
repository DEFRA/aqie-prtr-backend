import { health } from '#src/routes/health.js'
import { locations } from '#src/routes/locations.js'
import { getReports } from '#src/routes/get-reports.js'
import { getDownloadLink } from '#src/routes/get-download-link.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, ...locations, getReports, getDownloadLink])
    }
  }
}
