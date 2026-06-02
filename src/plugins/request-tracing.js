import { tracing } from '@defra/hapi-tracing'
import { config } from '#src/config.js'

export const requestTracing = {
  plugin: tracing.plugin,
  options: {
    tracingHeader: config.get('tracing.header')
  }
}
