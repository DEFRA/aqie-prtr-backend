import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
streamTsv,
readAllRows,
toInt,
toFloat,
toBool,
toDate
} from '../lib/tsv-reader.js'

function writeTsv(lines) {
const dir = mkdtempSync(join(tmpdir(), 'tsv-reader-'))
const path = join(dir, 'sample.tsv')
writeFileSync(path, lines.join('\n'))
return path
}

describe('streamTsv', () => {
it('parses header and rows', async () => {
const path = writeTsv(['id\tname', '1\tAlpha', '2\tBeta'])
const rows = await readAllRows(path)
expect(rows).toHaveLength(2)
expect(rows[0]).toMatchObject({ id: '1', name: 'Alpha' })
expect(rows[1]).toMatchObject({ id: '2', name: 'Beta' })
})

it('converts NULL literal to null', async () => {
const path = writeTsv(['code\tname', 'X\tNULL'])
const rows = await readAllRows(path)
expect(rows[0].name).toBeNull()
})

it('converts empty cells to null by default', async () => {
const path = writeTsv(['code\tname', 'X\t'])
const rows = await readAllRows(path)
expect(rows[0].name).toBeNull()
})

it('preserves empty cells when emptyAsNull=false', async () => {
const path = writeTsv(['code\tname', 'X\t'])
const rows = await readAllRows(path, { emptyAsNull: false })
expect(rows[0].name).toBe('')
})

it('attaches __lineNumber to each row (1-indexed, header counted)', async () => {
const path = writeTsv(['h', 'a', 'b'])
const rows = await readAllRows(path)
expect(rows[0].__lineNumber).toBe(2)
expect(rows[1].__lineNumber).toBe(3)
})

it('skips blank trailing lines', async () => {
const path = writeTsv(['h', 'a', '', ''])
const rows = await readAllRows(path)
expect(rows).toHaveLength(1)
})

it('streams large input row-by-row without loading into memory', async () => {
const lines = ['id\tval']
for (let i = 0; i < 1000; i++) lines.push(`${i}\t${i * 2}`)
const path = writeTsv(lines)
let count = 0
for await (const row of streamTsv(path)) {
count++
if (count === 1) expect(row).toMatchObject({ id: '0', val: '0' })
}
expect(count).toBe(1000)
})
})

describe('type coercion helpers', () => {
it('toInt returns integer or null', () => {
expect(toInt('42')).toBe(42)
expect(toInt('NULL')).toBeNull()
expect(toInt(null)).toBeNull()
expect(toInt('')).toBeNull()
expect(toInt('abc')).toBeNull()
})

it('toFloat returns number or null', () => {
expect(toFloat('3.14')).toBe(3.14)
expect(toFloat('-0.5')).toBe(-0.5)
expect(toFloat(null)).toBeNull()
expect(toFloat('')).toBeNull()
})

it('toBool maps 1/0 to true/false, anything else to null', () => {
expect(toBool('1')).toBe(true)
expect(toBool('0')).toBe(false)
expect(toBool(null)).toBeNull()
expect(toBool('yes')).toBeNull()
})

it('toDate parses MySQL datetime and date, returns null for sentinels', () => {
expect(toDate('2024-06-15 10:30:00')).toEqual(
new Date('2024-06-15T10:30:00Z')
)
expect(toDate('2024-06-15')).toEqual(new Date('2024-06-15T00:00:00Z'))
expect(toDate('0000-00-00 00:00:00')).toBeNull()
expect(toDate('not-a-date')).toBeNull()
expect(toDate(null)).toBeNull()
})
})
