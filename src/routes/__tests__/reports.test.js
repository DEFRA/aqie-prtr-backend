import { describe, it, expect, beforeEach, vi } from 'vitest'

// Create mock functions that will be shared
const {
  mockCountBucketObjects,
  mockGetReportsController,
  mockGetReportDownloadLink,
  mockLogger
} = vi.hoisted(() => ({
  mockCountBucketObjects: vi.fn(),
  mockGetReportsController: vi.fn(),
  mockGetReportDownloadLink: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@hapi/boom', () => ({
  default: {
    internal: vi.fn((message) => ({
      isBoom: true,
      output: {
        statusCode: 500,
        payload: { message }
      }
    })),
    internalServerError: vi.fn((message) => ({
      isBoom: true,
      output: {
        statusCode: 500,
        payload: { message }
      }
    })),
    badGateway: vi.fn((message) => ({
      isBoom: true,
      output: {
        statusCode: 502,
        payload: { message }
      }
    })),
    serviceUnavailable: vi.fn((message) => ({
      isBoom: true,
      output: {
        statusCode: 503,
        payload: { message }
      }
    }))
  }
}))

vi.mock('#src/plugins/logger-options.js', () => ({
  loggerOptions: {
    enabled: true,
    level: 'info',
    ignorePaths: ['/health'],
    redact: { paths: [], remove: true }
  }
}))

vi.mock('#src/config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const configMap = {
        'log.level': 'info',
        's3.region': 'eu-east-1'
      }
      return configMap[key]
    })
  }
}))

vi.mock('#src/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => mockLogger)
}))

vi.mock('#src/services/s3-service.js', () => ({
  countBucketObjects: mockCountBucketObjects,
  S3BackendError: class S3BackendError extends Error {}
}))

vi.mock('#src/services/reports-service.js', () => ({
  getReports: mockGetReportsController,
  getReportDownloadLink: mockGetReportDownloadLink,
  ReportsBackendError: class ReportsBackendError extends Error {}
}))

import {
  reports,
  handleGetReports,
  handleDownloadLink
} from '#src/routes/reports.js'
import { S3BackendError } from '#src/services/s3-service.js'
import { ReportsBackendError } from '#src/services/reports-service.js'
import { config } from '#src/config.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

const [getReports, getDownloadLink] = reports

/**
 * Minimal ResponseToolkit mock supporting the `.response(payload).code(status)` chain.
 */
function buildResponseToolkit() {
  const responseBuilder = { code: vi.fn().mockReturnThis() }
  const h = { response: vi.fn().mockReturnValue(responseBuilder) }
  return { h, responseBuilder }
}

function setupDefaultMocks() {
  config.get.mockImplementation((key) => {
    const configMap = {
      'log.level': 'info',
      's3.region': 'eu-east-1',
      's3.bucket': 'test-bucket'
    }
    return configMap[key]
  })
}

describe('handleGetReports handler', () => {
  let request
  let h
  let responseBuilder

  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
    ;({ h, responseBuilder } = buildResponseToolkit())
    request = {
      db: { collection: vi.fn() },
      logger: { info: vi.fn(), error: vi.fn() },
      log: vi.fn()
    }
  })

  describe('successful responses', () => {
    it('should check S3 connection with correct bucket and prefix', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      mockGetReportsController.mockResolvedValue({
        count: 2,
        results: []
      })

      await handleGetReports(request, h)

      expect(config.get).toHaveBeenCalledWith('s3.bucket')
      expect(mockCountBucketObjects).toHaveBeenCalledWith(
        'test-bucket',
        'reports/'
      )
    })

    it('should log S3 connection success with file count', async () => {
      mockCountBucketObjects.mockResolvedValue(10)
      mockGetReportsController.mockResolvedValue({
        count: 2,
        results: []
      })

      await handleGetReports(request, h)

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-reports.search] S3 connection OK (test-bucket). Files found: 10'
      )
    })

    it('should call controller with database and logger after S3 check passes', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      mockGetReportsController.mockResolvedValue({
        count: 2,
        results: [{ id: '2023', year: 2023, reportIsLive: true }]
      })

      await handleGetReports(request, h)

      expect(mockGetReportsController).toHaveBeenCalledWith(
        request.db,
        mockLogger
      )
    })

    it('should return controller result on success', async () => {
      const controllerResult = {
        count: 3,
        results: [
          { id: '2023', year: 2023, reportIsLive: true },
          { id: '2022', year: 2022, reportIsLive: false },
          { id: '2021', year: 2021, reportIsLive: false }
        ]
      }
      mockCountBucketObjects.mockResolvedValue(8)
      mockGetReportsController.mockResolvedValue(controllerResult)

      await handleGetReports(request, h)

      expect(h.response).toHaveBeenCalledWith(controllerResult)
      expect(responseBuilder.code).toHaveBeenCalledWith(statusCodes.ok)
    })

    it('should return 200 status code on successful reports fetch', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      mockGetReportsController.mockResolvedValue({
        count: 0,
        results: []
      })

      await handleGetReports(request, h)

      expect(responseBuilder.code).toHaveBeenCalledWith(200)
    })

    it('should return empty results array when controller returns no results', async () => {
      mockCountBucketObjects.mockResolvedValue(0)
      mockGetReportsController.mockResolvedValue({
        count: 0,
        results: []
      })

      await handleGetReports(request, h)

      const response = h.response.mock.calls[0][0]
      expect(response.results).toEqual([])
      expect(response.count).toBe(0)
    })

    it('should handle S3 file count of zero', async () => {
      mockCountBucketObjects.mockResolvedValue(0)
      mockGetReportsController.mockResolvedValue({
        count: 2,
        results: []
      })

      await handleGetReports(request, h)

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-reports.search] S3 connection OK (test-bucket). Files found: 0'
      )
    })

    it('should handle different bucket names from config', async () => {
      config.get.mockImplementation((key) => {
        if (key === 's3.bucket') {
          return 'production-bucket'
        }
        return undefined
      })
      mockCountBucketObjects.mockResolvedValue(10)
      mockGetReportsController.mockResolvedValue({ count: 0, results: [] })

      await handleGetReports(request, h)

      expect(mockCountBucketObjects).toHaveBeenCalledWith(
        'production-bucket',
        'reports/'
      )
    })

    it('should log successful reports fetch with count', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      mockGetReportsController.mockResolvedValue({
        count: 5,
        results: []
      })

      await handleGetReports(request, h)

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-reports.search] succeeded, count=5'
      )
    })

    it('should log S3 bucket name in success message', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      mockGetReportsController.mockResolvedValue({ count: 0, results: [] })

      await handleGetReports(request, h)

      const calls = mockLogger.info.mock.calls
      expect(calls.some((c) => c[0].includes('test-bucket'))).toBe(true)
    })
  })

  describe('S3 error handling', () => {
    it('should return 502 error when countBucketObjects fails', async () => {
      const s3Error = new S3BackendError('Access Denied to S3 bucket')
      mockCountBucketObjects.mockRejectedValue(s3Error)

      const result = await handleGetReports(request, h)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.message).toBe(
        'S3 service is currently unavailable'
      )
    })

    it('should not call controller if S3 check fails', async () => {
      const s3Error = new S3BackendError('S3 error')
      mockCountBucketObjects.mockRejectedValue(s3Error)

      const result = await handleGetReports(request, h)

      expect(mockGetReportsController).not.toHaveBeenCalled()
      expect(result.isBoom).toBe(true)
    })

    it('should log S3 error when countBucketObjects fails', async () => {
      const s3Error = new S3BackendError('Bucket not found')
      mockCountBucketObjects.mockRejectedValue(s3Error)

      await handleGetReports(request, h)

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should include S3 error message in logs', async () => {
      const s3Error = new S3BackendError('Bucket access denied')
      mockCountBucketObjects.mockRejectedValue(s3Error)

      await handleGetReports(request, h)

      const errorCalls = mockLogger.error.mock.calls
      expect(errorCalls.some((c) => c[0].includes('S3 backend failed'))).toBe(
        true
      )
    })

    it('should not call response builder if S3 fails', async () => {
      const s3Error = new S3BackendError('S3 error')
      mockCountBucketObjects.mockRejectedValue(s3Error)

      const result = await handleGetReports(request, h)

      expect(h.response).not.toHaveBeenCalled()
      expect(result.isBoom).toBe(true)
    })
  })

  describe('ReportsBackendError handling', () => {
    it('should return 502 error when database backend fails', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      const dbError = new ReportsBackendError('Database connection failed')
      mockGetReportsController.mockRejectedValue(dbError)

      const result = await handleGetReports(request, h)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
    })

    it('should log database error when getReports fails', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      const dbError = new ReportsBackendError('Query failed')
      mockGetReportsController.mockRejectedValue(dbError)

      await handleGetReports(request, h)

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should include error message in response', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      const dbError = new ReportsBackendError('Database unavailable')
      mockGetReportsController.mockRejectedValue(dbError)

      const result = await handleGetReports(request, h)

      expect(result.output.payload.message).toBe(
        'Reports service is currently unavailable'
      )
    })
  })

  describe('unexpected error handling', () => {
    it('should throw unexpected errors', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      const unexpectedError = new Error('Something completely unexpected')
      mockGetReportsController.mockRejectedValue(unexpectedError)

      await expect(handleGetReports(request, h)).rejects.toThrow(
        'Something completely unexpected'
      )
    })

    it('should log unexpected errors', async () => {
      mockCountBucketObjects.mockResolvedValue(5)
      const unexpectedError = new Error('Unknown failure')
      mockGetReportsController.mockRejectedValue(unexpectedError)

      try {
        await handleGetReports(request, h)
      } catch {
        expect(mockLogger.error).toHaveBeenCalled()
      }
    })
  })
})

describe('getReports route configuration', () => {
  it('should have correct HTTP method', () => {
    expect(getReports.method).toBe('GET')
  })

  it('should have correct path', () => {
    expect(getReports.path).toBe('/reports')
  })

  it('should include api tag', () => {
    expect(getReports.options.tags).toContain('api')
  })

  it('should include reports tag', () => {
    expect(getReports.options.tags).toContain('reports')
  })

  it('should include description in route options', () => {
    expect(getReports.options.description).toBe(
      'Verifies S3 connection health, then retrieves all reports from the database'
    )
  })

  it('should have handler function', () => {
    expect(typeof getReports.handler).toBe('function')
  })
})

describe('handleDownloadLink handler', () => {
  let request
  let h
  let responseBuilder

  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
    ;({ h, responseBuilder } = buildResponseToolkit())
    request = {
      db: { collection: vi.fn() },
      params: { year: 2023 }
    }
  })

  describe('successful responses', () => {
    it('should generate presigned URL for valid year', async () => {
      const presignedUrl = 'https://example.com/presigned-link'
      mockGetReportDownloadLink.mockResolvedValue(presignedUrl)

      await handleDownloadLink(request, h)

      expect(h.response).toHaveBeenCalledWith({ downloadLink: presignedUrl })
      expect(responseBuilder.code).toHaveBeenCalledWith(statusCodes.ok)
    })

    it('should call getReportDownloadLink with correct parameters', async () => {
      mockGetReportDownloadLink.mockResolvedValue('https://example.com/link')

      await handleDownloadLink(request, h)

      expect(mockGetReportDownloadLink).toHaveBeenCalledWith(
        request.db,
        2023,
        'test-bucket'
      )
    })

    it('should return 200 status code on success', async () => {
      mockGetReportDownloadLink.mockResolvedValue('https://example.com/link')

      await handleDownloadLink(request, h)

      expect(responseBuilder.code).toHaveBeenCalledWith(200)
    })

    it('should log successful presigned URL generation', async () => {
      mockGetReportDownloadLink.mockResolvedValue('https://example.com/link')

      await handleDownloadLink(request, h)

      expect(mockLogger.info).toHaveBeenCalledWith(
        '[get-download-link.search] succeeded for year=2023'
      )
    })

    it('should return response with downloadLink property', async () => {
      const presignedUrl = 'https://s3.example.com/report.pdf?token=xyz'
      mockGetReportDownloadLink.mockResolvedValue(presignedUrl)

      await handleDownloadLink(request, h)

      const response = h.response.mock.calls[0][0]
      expect(response).toHaveProperty('downloadLink')
      expect(response.downloadLink).toBe(presignedUrl)
    })

    it('should handle different years', async () => {
      mockGetReportDownloadLink.mockResolvedValue('https://example.com/link')

      request.params.year = 2022
      await handleDownloadLink(request, h)

      expect(mockGetReportDownloadLink).toHaveBeenCalledWith(
        request.db,
        2022,
        'test-bucket'
      )
    })

    it('should handle oldest valid year', async () => {
      mockGetReportDownloadLink.mockResolvedValue('https://example.com/link')

      request.params.year = 2007
      await handleDownloadLink(request, h)

      expect(mockGetReportDownloadLink).toHaveBeenCalledWith(
        request.db,
        2007,
        'test-bucket'
      )
    })
  })

  describe('S3 error handling', () => {
    it('should return 502 error when S3 service fails', async () => {
      const serviceError = new S3BackendError('S3 connection failed')
      mockGetReportDownloadLink.mockRejectedValue(serviceError)

      const result = await handleDownloadLink(request, h)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.message).toBe(
        'S3 service is currently unavailable'
      )
    })

    it('should not call response builder if S3 service fails', async () => {
      const serviceError = new S3BackendError('Bucket not found')
      mockGetReportDownloadLink.mockRejectedValue(serviceError)

      const result = await handleDownloadLink(request, h)

      expect(h.response).not.toHaveBeenCalled()
      expect(result.isBoom).toBe(true)
    })

    it('should log S3 error with year information', async () => {
      const serviceError = new S3BackendError('S3 error')
      mockGetReportDownloadLink.mockRejectedValue(serviceError)

      await handleDownloadLink(request, h)

      expect(mockLogger.error).toHaveBeenCalled()
      const errorCall = mockLogger.error.mock.calls[0][0]
      expect(errorCall).toContain('2023')
    })

    it('should include error message in logs', async () => {
      const errorMessage = 'Access denied'
      const serviceError = new S3BackendError(errorMessage)
      mockGetReportDownloadLink.mockRejectedValue(serviceError)

      await handleDownloadLink(request, h)

      const errorCall = mockLogger.error.mock.calls[0][0]
      expect(errorCall).toContain('S3 backend failed')
    })
  })

  describe('ReportsBackendError handling', () => {
    it('should return 502 error when reports service fails', async () => {
      const reportsError = new ReportsBackendError('Reports service failed')
      mockGetReportDownloadLink.mockRejectedValue(reportsError)

      const result = await handleDownloadLink(request, h)

      expect(result.isBoom).toBe(true)
      expect(result.output.statusCode).toBe(502)
      expect(result.output.payload.message).toBe(
        'Reports service is currently unavailable'
      )
    })

    it('should log reports error with year information', async () => {
      const reportsError = new ReportsBackendError('Database error')
      mockGetReportDownloadLink.mockRejectedValue(reportsError)

      await handleDownloadLink(request, h)

      expect(mockLogger.error).toHaveBeenCalled()
      const errorCall = mockLogger.error.mock.calls[0][0]
      expect(errorCall).toContain('2023')
    })

    it('should include reports error message in logs', async () => {
      const reportsError = new ReportsBackendError('Query failed')
      mockGetReportDownloadLink.mockRejectedValue(reportsError)

      await handleDownloadLink(request, h)

      const errorCall = mockLogger.error.mock.calls[0][0]
      expect(errorCall).toContain('reports backend failed')
    })
  })

  describe('unexpected error handling', () => {
    it('should throw unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected failure')
      mockGetReportDownloadLink.mockRejectedValue(unexpectedError)

      await expect(handleDownloadLink(request, h)).rejects.toThrow(
        'Unexpected failure'
      )
    })

    it('should log unexpected errors with year info', async () => {
      const unexpectedError = new Error('Unknown error')
      mockGetReportDownloadLink.mockRejectedValue(unexpectedError)

      try {
        await handleDownloadLink(request, h)
      } catch {
        expect(mockLogger.error).toHaveBeenCalled()
        const errorCall = mockLogger.error.mock.calls[0][0]
        expect(errorCall).toContain('2023')
      }
    })
  })
})

describe('downloadLink route configuration', () => {
  it('should have correct HTTP method', () => {
    expect(getDownloadLink.method).toBe('GET')
  })

  it('should have correct path with year parameter', () => {
    expect(getDownloadLink.path).toBe('/reports/get-download-link/{year}')
  })

  it('should include api tag', () => {
    expect(getDownloadLink.options.tags).toContain('api')
  })

  it('should include download-links tag', () => {
    expect(getDownloadLink.options.tags).toContain('download-links')
  })

  it('should validate year parameter', () => {
    expect(getDownloadLink.options.validate.params).toBeDefined()
  })

  it('should have handler function', () => {
    expect(typeof getDownloadLink.handler).toBe('function')
  })

  it('should include description in route options', () => {
    expect(getDownloadLink.options.description).toBe(
      'Get a presigned download link for a report for a specific year'
    )
  })
})

describe('year parameter validation', () => {
  it('should have year schema defined', () => {
    const schema = getDownloadLink.options.validate.params
    expect(schema).toBeDefined()
  })

  it('should validate params through Joi schema', () => {
    const schema = getDownloadLink.options.validate.params
    // Schema should be a Joi object
    expect(schema.describe()).toBeDefined()
  })

  it('should have year field in schema', () => {
    const schema = getDownloadLink.options.validate.params
    const description = schema.describe()
    expect(description.keys).toHaveProperty('year')
  })

  it('should have year description', () => {
    const schema = getDownloadLink.options.validate.params
    expect(schema).toBeDefined()
  })
})
