/**
* Verify a MongoDB collection.
* uses Node.js driver for verification.
*
* Usage:
* node scripts/tsv-ingest/verify.js # list ALL collections + counts
* node scripts/tsv-ingest/verify.js agencies # show count + all docs
* node scripts/tsv-ingest/verify.js facilities # show count + first 5 docs
* node scripts/tsv-ingest/verify.js agencies --count # just the count
*/

import { parseArgs } from 'node:util'
import { connect, db, close } from './lib/mongo.js'

async function main() {
const { values: argv, positionals } = parseArgs({
options: {
count: { type: 'boolean', default: false },
limit: { type: 'string', default: '5' }
},
allowPositionals: true,
strict: true
})

await connect()

// No collection name — list everything
if (positionals.length === 0) {
const collections = await db().listCollections().toArray()
if (collections.length === 0) {
process.stdout.write('No collections in database.\n')
} else {
process.stdout.write('Collections:\n')
for (const c of collections.sort((a, b) =>
a.name.localeCompare(b.name)
)) {
const count = await db().collection(c.name).countDocuments()
process.stdout.write(` ${c.name.padEnd(28)} ${count} docs\n`)
}
}
await close()
return
}

// Collection name given — show its contents
const name = positionals[0]
const limit = Number.parseInt(argv.limit, 10)

const exists = (await db().listCollections({ name }).toArray()).length > 0
if (!exists) {
process.stderr.write(`Collection "${name}" does not exist.\n`)
await close()
process.exit(1)
}

const count = await db().collection(name).countDocuments()
process.stdout.write(`Collection: ${name}\n`)
process.stdout.write(`Count: ${count}\n`)

if (argv.count) {
await close()
return
}

// Show all docs for small collections, otherwise first N
const showAll = count <= limit
const docs = await db()
.collection(name)
.find()
.limit(showAll ? 0 : limit)
.toArray()

process.stdout.write(
`\nShowing ${showAll ? 'all' : `first ${limit} of ${count}`} documents:\n`
)
for (const doc of docs) {
process.stdout.write(JSON.stringify(doc, null, 2) + '\n')
process.stdout.write('---\n')
}

await close()
}

main().catch(async (err) => {
process.stderr.write(`Error: ${err.message}\n`)
await close().catch(() => {})
process.exit(1)
})
