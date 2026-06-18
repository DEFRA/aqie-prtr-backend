/**
* TSV ingest configuration.
*
* Env vars override defaults so the same script runs unchanged on a dev
* laptop, in CI, and inside a CDP break-glass session. No host-specific
* paths are baked in — TSV_DIR must be set explicitly outside of a local
* `./tsvs` working directory.
*/

import { resolve } from 'node:path'

const TSV_DIR_DEFAULT = 'C:/Users/329763/Defra/prtr_discovery/prtr_files/prtr_public_export'
const BATCH_SIZE_DEFAULT = 1000
const VALID_LOG_FORMATS = ['ecs', 'pino-pretty']

function parsePositiveInt(name, value, fallback) {
if (value == null || value === '') return fallback
const n = Number.parseInt(value, 10)
if (!Number.isFinite(n) || n < 1) {
throw new Error(
`${name} must be a positive integer (got ${JSON.stringify(value)})`
)
}
return n
}

function parseLogFormat(value) {
if (value == null || value === '') return null
if (!VALID_LOG_FORMATS.includes(value)) {
throw new Error(
`LOG_FORMAT must be one of ${VALID_LOG_FORMATS.join('|')} (got ${JSON.stringify(value)})`
)
}
return value
}

export const config = {
// Where the Ricardo TSV files live. Override with TSV_DIR=/path/to/tsvs.
tsvDir: process.env.TSV_DIR ?? TSV_DIR_DEFAULT,

// MongoDB connection. Defaults to local MongoDB for dev. Production is
// injected via break-glass env vars.
mongoUri: process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017',
mongoDatabase: process.env.MONGO_DATABASE ?? 'aqie-prtr-backend',

// Bulk-write batch size. Larger = faster but more memory.
batchSize: parsePositiveInt(
'INGEST_BATCH_SIZE',
process.env.INGEST_BATCH_SIZE,
BATCH_SIZE_DEFAULT
),

// Parse TSVs but DON'T write to MongoDB.
dryRun: process.env.INGEST_DRY_RUN === 'true',

// pino log level. info for normal use; debug for tracing.
logLevel: process.env.LOG_LEVEL ?? 'info',

// Log output format. null = auto (pretty on TTY, ECS otherwise).
logFormat: parseLogFormat(process.env.LOG_FORMAT),

// Service version, included in ECS log records. CDP sets SERVICE_VERSION
// per build; null in local dev.
serviceVersion: process.env.SERVICE_VERSION ?? null
}

/** Resolve a TSV filename to an absolute path under config.tsvDir. */
export function tsvPath(filename) {
return resolve(config.tsvDir, filename)
}



