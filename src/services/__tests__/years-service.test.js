import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getYears } from '#src/services/years-service.js'

describe('getYears', () => {
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

  it('returns success with years sorted by year descending', async () => {
    const yearsData = [
      { yearID: '2023', year: 2023, yearIsLive: true },
      { yearID: '2022', year: 2022, yearIsLive: false },
      { yearID: '2021', year: 2021, yearIsLive: false }
    ]

    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(yearsData)
      })
    })

    const result = await getYears(mockDb, mockLogger)

    expect(result).toMatchObject({
      success: true,
      count: 3,
      years: [
        { id: '2023', year: 2023, yearIsLive: true },
        { id: '2022', year: 2022, yearIsLive: false },
        { id: '2021', year: 2021, yearIsLive: false }
      ]
    })
  })

  it('calls Years collection with find({})', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      })
    })

    await getYears(mockDb, mockLogger)

    expect(mockDb.collection).toHaveBeenCalledWith('Years')
    expect(mockCollection.find).toHaveBeenCalledWith({})
  })

  it('sorts results by year in descending order', async () => {
    const sortMock = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([])
    })
    mockCollection.find.mockReturnValue({ sort: sortMock })

    await getYears(mockDb, mockLogger)

    expect(sortMock).toHaveBeenCalledWith({ year: -1 })
  })

  it('returns empty array when no years are found', async () => {
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
      })
    })

    const result = await getYears(mockDb, mockLogger)

    expect(result).toMatchObject({
      success: true,
      count: 0,
      years: []
    })
  })

  it('maps yearID to id in response', async () => {
    const yearsData = [
      { yearID: '2023', year: 2023, yearIsLive: true }
    ]

    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(yearsData)
      })
    })

    const result = await getYears(mockDb, mockLogger)

    expect(result.years[0]).toHaveProperty('id', '2023')
    expect(result.years[0]).not.toHaveProperty('yearID')
  })

  it('throws error when database query fails', async () => {
    const dbError = new Error('Database connection failed')
    mockCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValue(dbError)
      })
    })

    await expect(getYears(mockDb, mockLogger)).rejects.toThrow(
      'Database connection failed'
    )

    expect(mockLogger.error).toHaveBeenCalledWith(
      dbError,
      'Failed to fetch years'
    )
  })

  it('throws error when collection method fails', async () => {
    const collectionError = new Error('Collection not found')
    mockDb.collection.mockImplementation(() => {
      throw collectionError
    })

    await expect(getYears(mockDb, mockLogger)).rejects.toThrow(
      'Collection not found'
    )

    expect(mockLogger.error).toHaveBeenCalledWith(
      collectionError,
      'Failed to fetch years'
    )
  })
})
