import { describe, it, expect, beforeEach, vi } from 'vitest'

// Create mock functions that will be shared
const { mockCountBucketObjects, mockGetReportsController, mockLogger } = vi.hoisted(() => ({
  mockCountBucketObjects: vi.fn(),
  mockGetReportsController: vi.fn(),
  mockLogger: {
    error: vi.fn(),
    info: vi.fn()
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
        's3.region': 'us-east-1'
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
  ReportsBackendError: class ReportsBackendError extends Error {}
}))

import { getReports } from '#src/routes/get-reports.js'
import { S3BackendError } from '#src/services/s3-service.js'
import { config } from '#src/config.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

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
      's3.region': 'us-east-1',
      's3.bucket': 'test-bucket'
    }
    return configMap[key]
  })
}

describe('getReports route', () => {
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

  it('should return error when database is not available', async () => {
    request.db = null

    mockCountBucketObjects.mockResolvedValue(5)
    mockGetReportsController.mockResolvedValue({
      count: 0,
      results: []
    })

    const result = await getReports.handler(request, h)

    expect(mockGetReportsController).toHaveBeenCalledWith(null, mockLogger)
  })

  it('should check S3 connection with correct bucket and prefix', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    mockGetReportsController.mockResolvedValue({
      count: 2,
      results: []
    })

    await getReports.handler(request, h)

    expect(config.get).toHaveBeenCalledWith('s3.bucket')
    expect(mockCountBucketObjects).toHaveBeenCalledWith('test-bucket', 'reports/')
  })

  it('should log S3 connection success with file count', async () => {
    mockCountBucketObjects.mockResolvedValue(10)
    mockGetReportsController.mockResolvedValue({
      count: 2,
      results: []
    })

    await getReports.handler(request, h)

    expect(mockLogger.info).toHaveBeenCalledWith(
      '[get-reports.search] S3 connection OK (test-bucket). Files found: 10'
    )
  })

  it('should return S3 error when countBucketObjects fails', async () => {
    const s3Error = new S3BackendError('Access Denied to S3 bucket')
    mockCountBucketObjects.mockRejectedValue(s3Error)

    const result = await getReports.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(502)
    expect(result.output.payload.message).toBe('S3 service is currently unavailable')
    expect(h.response).not.toHaveBeenCalled()
  })

  it('should log S3 error when countBucketObjects fails', async () => {
    const s3Error = new S3BackendError('Bucket not found')
    mockCountBucketObjects.mockRejectedValue(s3Error)

    const result = await getReports.handler(request, h)

    expect(result.isBoom).toBe(true)
  })

  it('should call controller with database and logger after S3 check passes', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    mockGetReportsController.mockResolvedValue({
      count: 2,
      results: [
        { id: '2023', year: 2023, reportIsLive: true }
      ]
    })

    await getReports.handler(request, h)

    expect(mockGetReportsController).toHaveBeenCalledWith(request.db, mockLogger)
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

    await getReports.handler(request, h)

    expect(h.response).toHaveBeenCalledWith(controllerResult)
    expect(responseBuilder.code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('should return 200 status code on successful reports fetch', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    mockGetReportsController.mockResolvedValue({
      count: 0,
      results: []
    })

    await getReports.handler(request, h)

    expect(responseBuilder.code).toHaveBeenCalledWith(200)
  })

  it('should return error when controller throws', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    const controllerError = new Error('Database connection failed')
    mockGetReportsController.mockRejectedValue(controllerError)

    await expect(async () => {
      await getReports.handler(request, h)
    }).rejects.toThrow('Database connection failed')
  })

  it('should not call controller if S3 check fails', async () => {
    const s3Error = new S3BackendError('S3 error')
    mockCountBucketObjects.mockRejectedValue(s3Error)

    const result = await getReports.handler(request, h)

    expect(mockGetReportsController).not.toHaveBeenCalled()
    expect(result.isBoom).toBe(true)
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

    await getReports.handler(request, h)

    expect(mockCountBucketObjects).toHaveBeenCalledWith('production-bucket', 'reports/')
  })

  it('should have correct route configuration', () => {
    expect(getReports.method).toBe('GET')
    expect(getReports.path).toBe('/reports')
    expect(getReports.options.tags).toContain('api')
    expect(getReports.options.tags).toContain('reports')
  })

  it('should include description in route options', () => {
    expect(getReports.options.description).toBe(
      'Verifies S3 connection health, then retrieves all reports from the database'
    )
  })

  it('should return empty results array when controller returns no results', async () => {
    mockCountBucketObjects.mockResolvedValue(0)
    mockGetReportsController.mockResolvedValue({
      count: 0,
      results: []
    })

    await getReports.handler(request, h)

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

    await getReports.handler(request, h)

    expect(mockLogger.info).toHaveBeenCalledWith(
      '[get-reports.search] S3 connection OK (test-bucket). Files found: 0'
    )
  })

  it('should use correct status code constant for errors', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    const s3Error = new S3BackendError('S3 connection failed')
    mockCountBucketObjects.mockRejectedValue(s3Error)

    const result = await getReports.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(502)
  })
})
