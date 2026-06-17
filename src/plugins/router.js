import { health } from '#src/routes/health.js'
import { locations } from '#src/routes/locations.js'
import { reports } from '#src/routes/reports.js'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, ...locations, ...reports])
    }
  }
}
