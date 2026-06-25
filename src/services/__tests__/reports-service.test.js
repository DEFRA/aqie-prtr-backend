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
  let mockPresignedUrl

  beforeEach(() => {
    vi.clearAllMocks()
    mockPresignedUrl = 'https://s3.example.com/presigned-url'

    mockDb = {}

    mockGeneratePresignedReportDownloadLink.mockResolvedValue(mockPresignedUrl)
  })

  describe('successful cases', () => {
    it('should search S3 metadata for the report year', async () => {
      const s3Key = 'reports/uk_prtr_dataset_2023.xml'
      mockFindKeyByMetadataFilename.mockResolvedValue(s3Key)

      await getReportDownloadLink(2023, 'test-bucket')

      expect(mockFindKeyByMetadataFilename).toHaveBeenCalledWith(
        'test-bucket',
        2023
      )
    })

    it('should call generatePresignedReportDownloadLink with S3 key from metadata search', async () => {
      const s3Key = 'reports/uk_prtr_dataset_2023.xml'
      mockFindKeyByMetadataFilename.mockResolvedValue(s3Key)

      await getReportDownloadLink(2023, 'test-bucket')

      expect(mockGeneratePresignedReportDownloadLink).toHaveBeenCalledWith(
        'test-bucket',
        s3Key,
        2023
      )
    })

    it('should log when searching S3 metadata', async () => {
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      await getReportDownloadLink(2023, 'test-bucket')

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-report-download] Searching S3 metadata for year=2023...'
      )
    })

    it('should log when S3 key found in metadata', async () => {
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      await getReportDownloadLink(2023, 'test-bucket')

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-report-download] Found S3 key in S3 for year=2023'
      )
    })

    it('should return presigned URL after S3 search', async () => {
      mockFindKeyByMetadataFilename.mockResolvedValue('key')

      const result = await getReportDownloadLink(2023, 'test-bucket')

      expect(result).toBe(mockPresignedUrl)
    })
  })

  describe('error handling - S3 failures', () => {
    it('should throw S3BackendError when metadata search fails', async () => {
      const { S3BackendError } = await import('#src/services/s3-service.js')

      const s3Error = new S3BackendError('S3 connection failed')
      mockFindKeyByMetadataFilename.mockRejectedValue(s3Error)

      await expect(getReportDownloadLink(2023, 'test-bucket')).rejects.toThrow(
        'S3 connection failed'
      )
    })

    it('should throw S3BackendError from presigned URL generation', async () => {
      const { S3BackendError } = await import('#src/services/s3-service.js')

      mockFindKeyByMetadataFilename.mockResolvedValue('key')
      const s3Error = new S3BackendError('Failed to generate URL')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(s3Error)

      await expect(getReportDownloadLink(2023, 'test-bucket')).rejects.toThrow(
        'Failed to generate URL'
      )
    })
  })

  describe('error handling - general failures', () => {
    it('should throw ReportsBackendError on unexpected errors', async () => {
      mockFindKeyByMetadataFilename.mockResolvedValue('key')
      const unexpectedError = new Error('Unknown error')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(unexpectedError)

      await expect(getReportDownloadLink(2023, 'test-bucket')).rejects.toThrow(
        ReportsBackendError
      )
    })

    it('should wrap errors with year context', async () => {
      mockFindKeyByMetadataFilename.mockResolvedValue('key')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(
        new Error('Unknown')
      )

      try {
        await getReportDownloadLink(2023, 'test-bucket')
      } catch (error) {
        expect(error.message).toContain('2023')
      }
    })

    it('should log errors', async () => {
      mockFindKeyByMetadataFilename.mockResolvedValue('key')
      mockGeneratePresignedReportDownloadLink.mockRejectedValue(
        new Error('Test error')
      )

      try {
        await getReportDownloadLink(2023, 'test-bucket')
      } catch {
        expect(mockLogger.error).toHaveBeenCalled()
      }
    })
  })
})
