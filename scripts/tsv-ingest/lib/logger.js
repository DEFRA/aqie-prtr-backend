/**
* Structured logger for the TSV ingest pipeline.
*
* Uses pino with the same ECS formatter the Hapi service uses
* (`src/plugins/logger-options.js`), so CDP's log stack indexes
* migration-script output into the same shape as the running service
* (`@timestamp`, `log.level`, `service.name`, `service.version`, ...).
*
* Format selection:
* - LOG_FORMAT=ecs → ECS JSON
* - LOG_FORMAT=pino-pretty → human-readable colour
* - unset on a TTY → pino-pretty (developer laptop)
* - unset off a TTY (CDP, CI, redirected file) → ECS JSON
*/

import pino from 'pino'
import { ecsFormat } from '@elastic/ecs-pino-format'
import { config } from '../config.js'

const SERVICE_NAME = 'aqie-prtr-backend-tsv-ingest'

const useEcs =
config.logFormat === 'ecs' ||
(config.logFormat == null && !process.stdout.isTTY)

const ecsFormatters = useEcs
? ecsFormat({
serviceName: SERVICE_NAME,
serviceVersion: config.serviceVersion
})
: {}

const transport = useEcs
? undefined
: {
target: 'pino-pretty',
options: { colorize: true, translateTime: 'SYS:HH:MM:ss' }
}

const pinoOptions = {
level: config.logLevel,
...ecsFormatters,
transport,
// Strip credentials and auth headers from any object we log. The Mongo URI
// is also redacted at the call site in lib/mongo.js, this is a safety net.
redact: {
paths: [
'mongoUri',
'config.mongoUri',
'*.password',
'*.token',
'headers.authorization',
'headers.cookie'
],
remove: true
}
}

// In pretty mode add a service tag so it's visible in console output.
// In ECS mode the ecsFormat() bindings carry service.name and pino's default
// bindings (pid, hostname) must remain untouched — ecs-pino-format reads them.
if (!useEcs) pinoOptions.base = { service: SERVICE_NAME }

const logger = pino(pinoOptions)

/** Return the singleton logger. Mirrors `src/common/helpers/logging/logger.js`. */
export function createLogger() {
return logger
}

/** Child logger that tags every line with `loader: name`. */
export function loaderLogger(name) {
return logger.child({ loader: name })
}



