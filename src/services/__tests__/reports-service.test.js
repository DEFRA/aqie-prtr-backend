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
    const reportsData = [
      { reportID: '2023', year: 2023, reportIsLive: true },
      { reportID: '2022', year: 2022, reportIsLive: false },
      { reportID: '2021', year: 2021, reportIsLive: false }
    ]

    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(reportsData)
      })
    })

    const result = await getReports(mockDb, mockLogger)

    expect(result).toMatchObject({
      count: 3,
      results: [
        { id: '2023', year: 2023, reportIsLive: true },
        { id: '2022', year: 2022, reportIsLive: false },
        { id: '2021', year: 2021, reportIsLive: false }
      ]
    })
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

    expect(result).toMatchObject({
      count: 0,
      results: []
    })
  })

  it('maps reportID to id in response', async () => {
    const reportsData = [{ reportID: '2023', year: 2023, reportIsLive: true }]

    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(reportsData)
      })
    })

    const result = await getReports(mockDb, mockLogger)

    expect(result.results[0]).toHaveProperty('id', '2023')
    expect(result.results[0]).not.toHaveProperty('reportID')
  })

  it('throws error when database query fails', async () => {
    const dbError = new Error('Database connection failed')
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValue(dbError)
      })
    })

    await expect(getReports(mockDb, mockLogger)).rejects.toThrow(
      'Database connection failed'
    )

    expect(mockLogger.error).toHaveBeenCalledWith(
      dbError,
      'Failed to fetch reports'
    )
  })

  it('throws error when collection method fails', async () => {
    const collectionError = new Error('Collection not found')
    mockDb.collection.mockImplementation(() => {
      throw collectionError
    })

    await expect(getReports(mockDb, mockLogger)).rejects.toThrow(
      'Collection not found'
    )

    expect(mockLogger.error).toHaveBeenCalledWith(
      collectionError,
      'Failed to fetch reports'
    )
  })
})
