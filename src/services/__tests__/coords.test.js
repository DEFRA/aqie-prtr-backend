import { describe, it, expect } from 'vitest'
import { bngToLatLng } from '#src/services/coords.js'

describe('coords.bngToLatLng', () => {
  it('converts BNG for Newcastle upon Tyne to expected WGS84 lat/lng', () => {
    // BNG (425030, 564310) is the real OS Names value for Newcastle upon Tyne
    const result = bngToLatLng({ x: 425030, y: 564310 })

    expect(result.lat).toBeCloseTo(54.978, 1)
    expect(result.lng).toBeCloseTo(-1.617, 1)
  })

  it('converts BNG for central London area to expected lat/lng', () => {
    // BNG (530000, 180000) ≈ central London
    const result = bngToLatLng({ x: 530000, y: 180000 })

    expect(result.lat).toBeCloseTo(51.5, 0)
    expect(result.lng).toBeCloseTo(-0.1, 0)
  })

  it('returns numeric lat and lng', () => {
    const result = bngToLatLng({ x: 400000, y: 300000 })

    expect(typeof result.lat).toBe('number')
    expect(typeof result.lng).toBe('number')
    expect(Number.isFinite(result.lat)).toBe(true)
    expect(Number.isFinite(result.lng)).toBe(true)
  })
})
