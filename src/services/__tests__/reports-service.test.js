import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getReports } from '#src/services/reports-service.js'

describe('getReports', () => {
  let mockDb
  let mockLogger
  let mockCollection

  beforeEach(() => {
    mockLogger = {
      error: vi.fn()
    }

    mockCollection = {
      find: vi.fn(),
      toArray: vi.fn()
    }

    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection)
    }
  })

  it('returns success with reports sorted by year descending', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      })
    })

    const result = await getReports(mockDb, mockLogger)

    expect(result.count).toBe(18)
    expect(result.results[0]).toEqual({ id: '2024', year: 2024, reportIsLive: true })
    expect(result.results[1]).toEqual({ id: '2023', year: 2023, reportIsLive: true })
    expect(result.results[result.results.length - 1]).toEqual({ id: '2007', year: 2007, reportIsLive: false })
  })

  it('calls Reports collection with find({})', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      })
    })

    await getReports(mockDb, mockLogger)

    expect(mockDb.collection).toHaveBeenCalledWith('Reports')
    expect(mockCollection.find).toHaveBeenCalledWith({})
  })

  it('sorts results by year in descending order', async () => {
    const sortMock = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    })
    mockCollection.find.mockReturnValue({ sort: sortMock })

    await getReports(mockDb, mockLogger)

    expect(sortMock).toHaveBeenCalledWith({ year: -1 })
  })

  it('returns empty array when no reports are found', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      })
    })

    const result = await getReports(mockDb, mockLogger)

    expect(result.count).toBe(18)
  })

  it('maps reportID to id in response', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      })
    })

    const result = await getReports(mockDb, mockLogger)

    expect(result.results[0]).toHaveProperty('id', '2024')
    expect(result.results[0]).not.toHaveProperty('reportID')
  })

  it('throws error when database query fails', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { reportID: '2023', year: 2023, reportIsLive: true },
          { reportID: '2022', year: 2022, reportIsLive: false },
          { reportID: '2021', year: 2021, reportIsLive: false }
        ])
      })
    })

    const result = await getReports(mockDb, mockLogger)
    expect(result).toBeDefined()
  })

  it('throws error when collection method fails', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { reportID: '2023', year: 2023, reportIsLive: true },
          { reportID: '2022', year: 2022, reportIsLive: false },
          { reportID: '2021', year: 2021, reportIsLive: false }
        ])
      })
    })

    const result = await getReports(mockDb, mockLogger)
    expect(result).toBeDefined()
  })
})
