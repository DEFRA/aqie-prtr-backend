/**
* Batched bulk upsert helper.
*
* Buffers documents up to config.batchSize, then issues a single
* unordered bulkWrite. Idempotent: running the loader twice produces the
* same end state.
*/

import { config } from '../config.js'

/**
* Create a new batcher.
*
* @param {import('mongodb').Collection} collection
* @param {string} idField - The field on each doc that becomes _id (e.g. "code", "acronym")
* @param {object} [opts]
* @param {number} [opts.size] - override batch size
*/
export function createUpsertBatcher(collection, idField, opts = {}) {
const size = opts.size ?? config.batchSize
let buffer = []
let written = 0

return {
/** Queue a document; flushes automatically when batch is full. */
async add(doc) {
const _id = doc[idField]
if (_id === undefined || _id === null) {
throw new Error(
`upsert: doc missing idField "${idField}": ${JSON.stringify(doc).slice(0, 200)}`
)
}
// Build doc with _id set; remove the source idField if it was just for the key
buffer.push({
replaceOne: {
filter: { _id },
replacement: { ...doc, _id },
upsert: true
}
})
if (buffer.length >= size) await this.flush()
},

/** Force-flush any buffered documents. Call after the last add(). */
async flush() {
if (buffer.length === 0) return
if (config.dryRun) {
written += buffer.length
buffer = []
return
}
const result = await collection.bulkWrite(buffer, { ordered: false })
// Count each doc once: replaceOne reports a replaced doc as BOTH matched
// and modified, which would double-count. upserted = newly inserted;
// matched = found and replaced (whether content changed or not).
written += result.upsertedCount + result.matchedCount
buffer = []
},

/** Total docs written by this batcher (across all batches). */
get written() {
return written
}
}
}
