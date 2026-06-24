import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getReports,
  getReportDownloadLink,
  ReportsBackendError
} from '#src/services/reports-service.js'

// Mock the S3 service - hoisted to avoid initialization issues
const {
  mockFindKeyByMetadataFilename,
  mockGeneratePresignedReportDownloadLink,
  mockLogger
} = vi.hoisted(() => ({
  mockFindKeyByMetadataFilename: vi.fn(),
  mockGeneratePresignedReportDownloadLink: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('#src/services/s3-service.js', () => ({
  findKeyByMetadataFilename: mockFindKeyByMetadataFilename,
  generatePresignedReportDownloadLink: mockGeneratePresignedReportDownloadLink,
  S3BackendError: class S3BackendError extends Error {}
}))

vi.mock('#src/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => mockLogger)
}))

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
  let mockCollection

  beforeEach(() => {
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

      const result = await getReports(mockDb)

      expect(result.count).toBe(19)
      expect(result.results[0]).toEqual({
        id: '2007',
        year: 2007,
        reportIsLive: true
      })
      expect(result.results[1]).toEqual({
        id: '2008',
        year: 2008,
        reportIsLive: true
      })
    })

    it('returns reports sorted by year ascending in result array', async () => {
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })

      const result = await getReports(mockDb)

      expect(result.results.length).toBeGreaterThan(0)
      // Check that years are in ascending order
      for (let i = 0; i < result.results.length - 1; i++) {
        expect(result.results[i].year).toBeLessThanOrEqual(
          result.results[i + 1].year
        )
      }
    })
  })
})

describe('getReportDownloadLink', () => {
  let mockDb
  let mockReportsCollection
  let mockPresignedUrl

  beforeEach(() => {
    vi.clearAllMocks()
    mockPresignedUrl = 'https://s3.example.com/presigned-url'

    mockReportsCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn()
    }

    mockDb = {
      collection: vi.fn().mockReturnValue(mockReportsCollection)
    }

    mockGeneratePresignedReportDownloadLink.mockResolvedValue(mockPresignedUrl)
  })

  describe('successful cases - DB hit', () => {
    it('should find S3 key in database and use it directly', async () => {
      const s3Key = 'reports/uk_prtr_dataset_2023.xml'
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023, s3Key })

      const result = await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(result).toBe(mockPresignedUrl)
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-report-download] Found S3 key in DB for year=2023'
      )
    })

    it('should call generatePresignedReportDownloadLink with correct parameters', async () => {
      const s3Key = 'reports/uk_prtr_dataset_2023.xml'
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023, s3Key })

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockGeneratePresignedReportDownloadLink).toHaveBeenCalledWith(
        'test-bucket',
        s3Key,
        2023
      )
    })

    it('should not search S3 if key found in DB', async () => {
      const s3Key = 'reports/uk_prtr_dataset_2023.xml'
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023, s3Key })

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockFindKeyByMetadataFilename).not.toHaveBeenCalled()
    })

    it('should return presigned URL on DB hit', async () => {
      mockReportsCollection.findOne.mockResolvedValue({
        year: 2023,
        s3Key: 'key'
      })

      const result = await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(result).toBe(mockPresignedUrl)
    })
  })

  describe('successful cases - S3 fallback', () => {
    it('should search S3 when key not in database', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 }) // no s3Key
      const s3Key = 'reports/uk_prtr_dataset_2023.xml'
      mockFindKeyByMetadataFilename.mockResolvedValue(s3Key)

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockFindKeyByMetadataFilename).toHaveBeenCalledWith(
        'test-bucket',
        2023
      )
    })

    it('should call generatePresignedReportDownloadLink with S3 key from metadata search', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      const s3Key = 'reports/uk_prtr_dataset_2023.xml'
      mockFindKeyByMetadataFilename.mockResolvedValue(s3Key)

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockGeneratePresignedReportDownloadLink).toHaveBeenCalledWith(
        'test-bucket',
        s3Key,
        2023
      )
    })

    it('should log when searching S3 metadata', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-report-download] S3 key not in DB for year=2023, searching S3 metadata...'
      )
    })

    it('should log when S3 key found in metadata', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-report-download] Found S3 key in S3 for year=2023'
      )
    })

    it('should return presigned URL after S3 search', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      const result = await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(result).toBe(mockPresignedUrl)
    })
  })

  describe('database lookup failure handling', () => {
    it('should handle database lookup errors gracefully', async () => {
      const dbError = new Error('Database connection failed')
      mockReportsCollection.findOne.mockRejectedValue(dbError)
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should fall back to S3 search on DB error', async () => {
      mockReportsCollection.findOne.mockRejectedValue(new Error('DB error'))
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      expect(mockFindKeyByMetadataFilename).toHaveBeenCalled()
    })

    it('should log warning when DB lookup fails', async () => {
      const dbError = new Error('Database connection failed')
      mockReportsCollection.findOne.mockRejectedValue(dbError)
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      await getReportDownloadLink(mockDb, 2023, 'test-bucket')

      const warnCall = mockLogger.warn.mock.calls[0][0]
      expect(warnCall).toContain('Database lookup failed')
      expect(warnCall).toContain('year=2023')
    })
  })

  describe('error handling - S3 failures', () => {
    it('should throw S3BackendError when metadata search fails', async () => {
      const { S3BackendError } = await import('#src/services/s3-service.js')

      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      const s3Error = new S3BackendError('S3 connection failed')
      mockFindKeyByMetadataFilename.mockRejectedValue(s3Error)

      await expect(
        getReportDownloadLink(mockDb, 2023, 'test-bucket')
      ).rejects.toThrow('S3 connection failed')
    })

    it('should throw S3BackendError from presigned URL generation', async () => {
      const { S3BackendError } = await import('#src/services/s3-service.js')

      mockReportsCollection.findOne.mockResolvedValue({
        year: 2023,
        s3Key: 'key'
      })
      const s3Error = new S3BackendError('Failed to generate URL')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(s3Error)

      await expect(
        getReportDownloadLink(mockDb, 2023, 'test-bucket')
      ).rejects.toThrow('Failed to generate URL')
    })
  })

  describe('error handling - general failures', () => {
    it('should throw ReportsBackendError on unexpected errors', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      mockFindKeyByMetadataFilename.mockResolvedValue('key')
      const unexpectedError = new Error('Unknown error')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(unexpectedError)

      await expect(
        getReportDownloadLink(mockDb, 2023, 'test-bucket')
      ).rejects.toThrow(ReportsBackendError)
    })

    it('should wrap errors with year context', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      mockFindKeyByMetadataFilename.mockResolvedValue('key')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(
        new Error('Unknown')
      )

      try {
        await getReportDownloadLink(mockDb, 2023, 'test-bucket')
      } catch (error) {
        expect(error.message).toContain('2023')
      }
    })

    it('should log errors', async () => {
      mockReportsCollection.findOne.mockResolvedValue({ year: 2023 })
      mockFindKeyByMetadataFilename.mockResolvedValue('key')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(
        new Error('Test error')
      )

      try {
        await getReportDownloadLink(mockDb, 2023, 'test-bucket')
      } catch {
        expect(mockLogger.error).toHaveBeenCalled()
      }
    })
  })
})
