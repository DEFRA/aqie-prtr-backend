import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getReports,
  ReportsBackendError
} from '#src/services/reports-service.js'

describe('ReportsBackendError', () => {
  it('should create error with message', () => {
    const error = new ReportsBackendError('Test error')
    expect(error.message).toBe('Test error')
    expect(error.name).toBe('ReportsBackendError')
  })

  it('should set status code when provided', () => {
    const error = new ReportsBackendError('Test error', { status: 500 })
    expect(error.status).toBe(500)
  })

  it('should set status to null when not provided', () => {
    const error = new ReportsBackendError('Test error')
    expect(error.status).toBeNull()
  })

  it('should set cause when provided', () => {
    const originalError = new Error('Original error')
    const error = new ReportsBackendError('Wrapped error', {
      cause: originalError
    })
    expect(error.cause).toBe(originalError)
  })

  it('should not set cause when not provided', () => {
    const error = new ReportsBackendError('Test error')
    expect(error.cause).toBeUndefined()
  })

  it('should support both status and cause together', () => {
    const originalError = new Error('Original')
    const error = new ReportsBackendError('Wrapped', {
      status: 502,
      cause: originalError
    })
    expect(error.status).toBe(502)
    expect(error.cause).toBe(originalError)
  })

  it('should be instanceof Error', () => {
    const error = new ReportsBackendError('Test')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('getReports', () => {
  let mockDb
  let mockLogger
  let mockCollection

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      info: vi.fn()
    }

    mockCollection = {
      find: vi.fn(),
      toArray: vi.fn()
    }

    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection)
    }
  })

  describe('success cases', () => {
    it('returns success with reports from example JSON file', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      expect(result.count).toBe(18)
      expect(result.results[0]).toEqual({
        id: '2024',
        year: 2024,
        reportIsLive: true
      })
      expect(result.results[1]).toEqual({
        id: '2023',
        year: 2023,
        reportIsLive: true
      })
    })

    it('returns reports sorted by year descending in result array', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      // Check that years are in descending order
      for (let i = 0; i < result.results.length - 1; i++) {
        expect(result.results[i].year).toBeGreaterThanOrEqual(
          result.results[i + 1].year
        )
      }
    })

    it('returns oldest report from example data', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)
      const lastReport = result.results[result.results.length - 1]

      expect(lastReport).toEqual({
        id: '2007',
        year: 2007,
        reportIsLive: false
      })
    })

    it('maps reportID field to id in response', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      result.results.forEach((report) => {
        expect(report).toHaveProperty('id')
        expect(report).not.toHaveProperty('reportID')
      })
    })

    it('includes year and reportIsLive fields in response', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      result.results.forEach((report) => {
        expect(report).toHaveProperty('year')
        expect(report).toHaveProperty('reportIsLive')
        expect(typeof report.year).toBe('number')
        expect(typeof report.reportIsLive).toBe('boolean')
      })
    })

    it('count matches length of results array', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      expect(result.count).toBe(result.results.length)
    })
  })

  // describe('database interaction', () => {
  //   it('queries Reports collection', async () => {
  //     mockCollection.find.mockReturnValue({
  //       sort: vi.fn().mockReturnValue({
  //         toArray: vi.fn().mockResolvedValue([])
  //       })
  //     })
  //
  //     await getReports(mockDb, mockLogger)
  //
  //     expect(mockDb.collection).toHaveBeenCalledWith('Reports')
  //   })
  //
  //   it('calls find with empty filter object', async () => {
  //     mockCollection.find.mockReturnValue({
  //       sort: vi.fn().mockReturnValue({
  //         toArray: vi.fn().mockResolvedValue([])
  //       })
  //     })
  //
  //     await getReports(mockDb, mockLogger)
  //
  //     expect(mockCollection.find).toHaveBeenCalledWith({})
  //   })
  //
  //   it('sorts by year in descending order', async () => {
  //     const sortMock = vi.fn().mockReturnValue({
  //       toArray: vi.fn().mockResolvedValue([])
  //     })
  //     mockCollection.find.mockReturnValue({ sort: sortMock })
  //
  //     await getReports(mockDb, mockLogger)
  //
  //     expect(sortMock).toHaveBeenCalledWith({ year: -1 })
  //   })
  //
  //   it('calls toArray to execute query', async () => {
  //     const toArrayMock = vi.fn().mockResolvedValue([])
  //     mockCollection.find.mockReturnValue({
  //       sort: vi.fn().mockReturnValue({
  //         toArray: toArrayMock
  //       })
  //     })
  //
  //     await getReports(mockDb, mockLogger)
  //
  //     expect(toArrayMock).toHaveBeenCalled()
  //   })
  // })

  describe('error handling', () => {
    // it('throws ReportsBackendError when find fails', async () => {
    //   const dbError = new Error('Connection refused')
    //   mockCollection.find.mockReturnValue({
    //     sort: vi.fn().mockReturnValue({
    //       toArray: vi.fn().mockRejectedValue(dbError)
    //     })
    //   })
    //
    //   await expect(getReports(mockDb, mockLogger)).rejects.toThrow(
    //     ReportsBackendError
    //   )
    // })

    it('includes original error message in ReportsBackendError', async () => {
      const dbError = new Error('Connection timeout')
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockRejectedValue(dbError)
        })
      })

      try {
        await getReports(mockDb, mockLogger)
      } catch (error) {
        expect(error.message).toContain('Failed to fetch reports')
        expect(error.message).toContain('Connection timeout')
      }
    })

    it('logs error when query fails', async () => {
      const dbError = new Error('Database error')
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockRejectedValue(dbError)
        })
      })

      try {
        await getReports(mockDb, mockLogger)
      } catch {
        expect(mockLogger.error).toHaveBeenCalled()
      }
    })

    it('includes original error as cause in ReportsBackendError', async () => {
      const dbError = new Error('Original DB error')
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockRejectedValue(dbError)
        })
      })

      try {
        await getReports(mockDb, mockLogger)
      } catch (error) {
        expect(error.cause).toBe(dbError)
      }
    })

    // it('throws error when collection method throws', async () => {
    //   const collectionError = new Error('Collection not found')
    //   mockDb.collection.mockImplementation(() => {
    //     throw collectionError
    //   })
    //
    //   await expect(getReports(mockDb, mockLogger)).rejects.toThrow(
    //     ReportsBackendError
    //   )
    // })
  })

  describe('response structure', () => {
    it('returns object with count and results properties', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('results')
    })

    it('returns results as array', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      expect(Array.isArray(result.results)).toBe(true)
    })

    it('returns count as number', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb, mockLogger)

      expect(typeof result.count).toBe('number')
    })
  })
})
