/**
* Streaming TSV reader.
*
* Handles:
* - Tabs,
* - Literal "NULL" for null values
* - Empty string "" — by default treated as null; loaders can override
* - Header row is the first line
*
* Streams the file row-by-row.
*/

import { createReadStream } from 'node:fs'

/**
* Stream rows from a TSV file as objects keyed by the header row.
*
* split is only on `\n` (not on `\r`). Some TSV files might have embedded carriage returns inside text fields
* like `comments`. Node's `readline` would treat those as row terminators
* — splitting one logical row across multiple "lines". So we hand-parse:
* split on `\n`, then strip a trailing `\r` from each line (for CRLF
* line endings on Windows-saved files), but PRESERVE any other `\r`
* inside cells.
*
* @param {string} path - Absolute path to TSV file
* @param {object} [opts]
* @param {boolean} [opts.emptyAsNull=true] - Convert "" to null
* @returns {AsyncGenerator<Record<string, string|null>>}
*/
export async function* streamTsv(path, opts = {}) {
const emptyAsNull = opts.emptyAsNull !== false

const stream = createReadStream(path, { encoding: 'utf8' })

let headers = null
let lineNumber = 0
let buffer = ''

for await (const chunk of stream) {
buffer += chunk
let nl
while ((nl = buffer.indexOf('\n')) !== -1) {
// Pop the next line from the buffer
let line = buffer.slice(0, nl)
buffer = buffer.slice(nl + 1)

// If a CRLF line ending was used, strip the trailing \r
if (line.endsWith('\r')) line = line.slice(0, -1)

lineNumber++
if (lineNumber === 1) {
headers = line.split('\t').map((h) => h.trim())
continue
}
if (line === '') continue

const cells = line.split('\t')
const row = {}
for (let i = 0; i < headers.length; i++) {
const raw = cells[i] ?? ''
row[headers[i]] = normaliseCell(raw, emptyAsNull)
}
row.__lineNumber = lineNumber
row.__columnCount = cells.length
yield row
}
}

// Any trailing content without a terminating newline (rare)
if (buffer.length > 0) {
if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1)
if (buffer === '') return
lineNumber++
if (lineNumber === 1) {
headers = buffer.split('\t').map((h) => h.trim())
return
}
const cells = buffer.split('\t')
const row = {}
for (let i = 0; i < headers.length; i++) {
const raw = cells[i] ?? ''
row[headers[i]] = normaliseCell(raw, emptyAsNull)
}
row.__lineNumber = lineNumber
row.__columnCount = cells.length
yield row
}
}

/**
* Normalise a raw cell string.
* - "NULL" literal → null
* - "" (empty) → null when emptyAsNull, otherwise ""
* - Anything else returned as-is (no automatic type coercion; loaders cast as needed)
*/
function normaliseCell(raw, emptyAsNull) {
if (raw === 'NULL') return null
if (raw === '' && emptyAsNull) return null
return raw
}

/** Parse a string to integer; return null if blank/NULL/not-a-number. */
export function toInt(value) {
if (value === null || value === undefined || value === '') return null
const n = Number.parseInt(value, 10)
return Number.isFinite(n) ? n : null
}

/** Parse a string to float; return null if blank/NULL/not-a-number. */
export function toFloat(value) {
if (value === null || value === undefined || value === '') return null
const n = Number.parseFloat(value)
return Number.isFinite(n) ? n : null
}

/** Parse "1" / "0" as boolean; null otherwise. */
export function toBool(value) {
if (value === '1' || value === 1 || value === true) return true
if (value === '0' || value === 0 || value === false) return false
return null
}

/**
* Parse a MySQL datetime "YYYY-MM-DD HH:MM:SS" or date "YYYY-MM-DD" to Date.
* Returns null for "0000-00-00..." sentinel values or anything unparseable.
*/
export function toDate(value) {
if (value === null || value === undefined || value === '') return null
if (typeof value === 'string' && value.startsWith('0000-')) return null
// Treat MySQL datetime as UTC (no timezone in source)
const iso =
typeof value === 'string'
? value.includes(' ')
? value.replace(' ', 'T') + 'Z'
: value + 'T00:00:00Z'
: value
const d = new Date(iso)
return Number.isNaN(d.getTime()) ? null : d
}

/**
* Read all rows of a TSV into an array. Use for small reference files only —
*/
export async function readAllRows(path, opts) {
const rows = []
for await (const row of streamTsv(path, opts)) {
rows.push(row)
}
return rows
}

/**
* Stream rows AND enforce a column-count contract.
*
* For malformed rows whenever a text
* field contains an embedded `\n` —
* one logical row becomes two physical lines, neither of which has the right
* number of columns. The parser can't tell a "real" row terminator from an
* embedded one without quote-aware parsing the source doesn't support.
*
* This helper yields only rows whose cell count matches the header; any row
* with a different count is written to the supplied quarantine instance with
* a standardised reason and source line number. The decision to quarantine
* is deliberate for data quality and ownership reasons
*
* @param {string} path - Absolute path to TSV
* @param {number} expectedCols - Column count from the TSV's header
* @param {{ add: Function }} quarantine - Quarantine instance from createQuarantine()
* @param {object} [opts] - Forwarded to streamTsv
*/
export async function* streamValidatedTsv(
path,
expectedCols,
quarantine,
opts
) {
for await (const row of streamTsv(path, opts)) {
if (row.__columnCount !== expectedCols) {
await quarantine.add({
row,
reason: `row has ${row.__columnCount} columns, expected ${expectedCols} — likely embedded newline in source field`,
ricardoRowId: row.__lineNumber ?? null
})
continue
}
yield row
}
}

/**
* readAllRows + streamValidatedTsv. For small reference files only —
*/
export async function readAllValidatedRows(
path,
expectedCols,
quarantine,
opts
) {
const rows = []
for await (const row of streamValidatedTsv(
path,
expectedCols,
quarantine,
opts
)) {
rows.push(row)
}
return rows
}
