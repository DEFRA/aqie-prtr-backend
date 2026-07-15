/**
* TSV ingest CLI runner.
*
* Usage:
* node scripts/tsv-ingest/index.js # run all loaders
* node scripts/tsv-ingest/index.js --only=agencies # one loader by name
* node scripts/tsv-ingest/index.js --phase=reference # all loaders in a phase
* node scripts/tsv-ingest/index.js --dry-run # parse but don't write
* TSV_DIR= location of tsv files node scripts/tsv-ingest/index.js
*
* Exit codes:
* 0 — all loaders completed successfully
* 1 — at least one loader failed (cron / CDP can alert on this)
*/

import { parseArgs } from 'node:util'
import { config } from './config.js'
import { createLogger } from './lib/logger.js'
import { connect, db, close } from './lib/mongo.js'
import { LOADERS } from './loaders/index.js'

const logger = createLogger()

async function main() {
const { values: argv } = parseArgs({
options: {
only: { type: 'string' },
phase: { type: 'string' },
'dry-run': { type: 'boolean', default: false },
reset: { type: 'boolean', default: false },
'confirm-reset': { type: 'boolean', default: false },
help: { type: 'boolean', short: 'h' }
},
strict: true
})

if (argv.help) {
process.stdout.write(USAGE)
process.exit(0)
}

// Two-flag guard against accidental destructive runs.
if (argv.reset && !argv['confirm-reset']) {
process.stderr.write(
'--reset drops the entire database (irreversible).\n' +
'Re-run with --reset --confirm-reset to proceed.\n'
)
process.exit(1)
}

if (argv['dry-run']) config.dryRun = true

const toRun = LOADERS.filter((l) => {
if (argv.only) return l.meta.name === argv.only
if (argv.phase) return l.meta.phase === argv.phase
return true
})

if (toRun.length === 0) {
logger.error(
{ filter: { only: argv.only, phase: argv.phase } },
'no loaders matched the filter'
)
process.exit(1)
}

logger.info(
{
loaders: toRun.map((l) => l.meta.name),
dryRun: config.dryRun,
tsvDir: config.tsvDir,
database: config.mongoDatabase
},
'tsv ingest run starting'
)

let failed = false
try {
await connect()

if (argv.reset) {
logger.warn(
{ database: config.mongoDatabase },
'RESET: dropping entire database before ingest'
)
await db().dropDatabase()
logger.info(
{ database: config.mongoDatabase },
'database dropped — starting from empty state'
)
}

const results = []
for (const loader of toRun) {
const start = Date.now()
try {
const result = await loader.run()
const ms = Date.now() - start
results.push({ loader: loader.meta.name, ms, ...result })
logger.info(
{ loader: loader.meta.name, ms, ...result },
'loader completed'
)
} catch (err) {
failed = true
// Pass the Error object directly — pino's std serialiser (and ECS
// format) will expand it into structured `error.*` fields.
logger.error({ loader: loader.meta.name, err }, 'loader failed')
// Stop on first failure — easier to debug. Loaders are idempotent
// so restart after fixing is safe.
break
}
}

logger.info({ results, failed }, 'tsv ingest run complete')
} finally {
await close().catch((err) =>
logger.warn({ err }, 'error closing mongo connection')
)
}

process.exit(failed ? 1 : 0)
}

const USAGE = `
Usage: node scripts/tsv-ingest/index.js [options]

Options:
--only=<name> Run a single loader by name (e.g. --only=agencies)
--phase=<name> Run all loaders in a phase (e.g. --phase=reference)
--dry-run Parse TSVs and report counts; do NOT write to MongoDB
--reset Drop the entire database before ingest. Requires --confirm-reset.
--confirm-reset Required alongside --reset to actually drop the database.
-h, --help Show this help

Environment variables:
TSV_DIR Directory containing the TSV files (default: ./tsvs)
MONGO_URI MongoDB connection string
MONGO_DATABASE Database name (default: aqie-prtr-backend)
INGEST_BATCH_SIZE Bulk-write batch size (default: 1000)
INGEST_DRY_RUN Same as --dry-run flag (set to "true")
LOG_LEVEL pino log level (default: info)
LOG_FORMAT ecs | pino-pretty (default: auto by TTY)
SERVICE_VERSION Service version for ECS logs (set by CDP per build)
`

main().catch((err) => {
logger.fatal({ err }, 'unhandled error in main()')
process.exit(1)
})
