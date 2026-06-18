/**
* MongoDB connection wrapper for the TSV ingest pipeline.
*
* Separate from the Hapi server's mongodb plugin because this script runs
* standalone (CLI / cron job), not inside the request lifecycle.
*/

import { MongoClient } from 'mongodb'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const logger = createLogger()

let client = null

export async function connect() {
if (client) return client
logger.info(
{ uri: redactUri(config.mongoUri), database: config.mongoDatabase },
'connecting to mongo'
)
client = new MongoClient(config.mongoUri, {
// Defaults tuned for a one-shot migration that may do large bulk writes.
maxPoolSize: 10,
serverSelectionTimeoutMS: 30000,
socketTimeoutMS: 600000, // 10 minutes — covers large bulk writes on big collections
heartbeatFrequencyMS: 30000
})
try {
await client.connect()
await client.db(config.mongoDatabase).command({ ping: 1 })
} catch (err) {
// Discard the client so a retry doesn't reuse a half-initialised one.
// Don't propagate the driver's error verbatim — its toString sometimes
// includes the raw URI. Surface a generic message and rely on the logged
// (redacted) `err` for debugging.
logger.error({ err }, 'mongo connection failed')
client = null
throw new Error('mongo connection failed (see preceding error)')
}
logger.info('mongo connected')
return client
}

export function db() {
if (!client) throw new Error('mongo not connected — call connect() first')
return client.db(config.mongoDatabase)
}

export async function close() {
if (client) {
await client.close()
client = null
logger.info('mongo closed')
}
}

/**
* Hide credentials in a mongodb URI before logging it.
*
* Handles the standard "scheme://user:pass@host" userinfo form. Mongo URIs
* don't put credentials in the query string in practice, so we don't try to
* cover that case.
*/
function redactUri(uri) {
return uri.replace(/\/\/([^:/?#]+):([^@/?#]+)@/, '//***:***@')
}
