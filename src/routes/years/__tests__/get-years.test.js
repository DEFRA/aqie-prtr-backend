import { describe, it, expect, beforeEach, vi } from 'vitest'

// Create mock functions that will be shared
const { mockCountBucketObjects, mockGetYearsController } = vi.hoisted(() => ({
  mockCountBucketObjects: vi.fn(),
  mockGetYearsController: vi.fn()
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
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn()
  }))
}))

vi.mock('#src/services/s3-service.js', () => ({
  countBucketObjects: mockCountBucketObjects
}))

vi.mock('#src/services/years-service.js', () => ({
  getYears: mockGetYearsController
}))

import { getYears } from '#src/routes/years/get-years.js'
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

describe('getYears route', () => {
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

    const result = await getYears.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(statusCodes.internalServerError)
    expect(result.output.payload.message).toBe('Server configuration error')
    expect(h.response).not.toHaveBeenCalled()
  })

  it('should check S3 connection with correct bucket and prefix', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    mockGetYearsController.mockResolvedValue({
      success: true,
      count: 2,
      years: []
    })

    await getYears.handler(request, h)

    expect(config.get).toHaveBeenCalledWith('s3.bucket')
    expect(mockCountBucketObjects).toHaveBeenCalledWith('test-bucket', 'reports/')
  })

  it('should log S3 connection success with file count', async () => {
    mockCountBucketObjects.mockResolvedValue(10)
    mockGetYearsController.mockResolvedValue({
      success: true,
      count: 2,
      years: []
    })

    await getYears.handler(request, h)

    expect(request.log).toHaveBeenCalledWith(
      ['info', 's3'],
      'S3 connection OK (test-bucket). Files found: 10'
    )
  })

  it('should return S3 error when countBucketObjects fails', async () => {
    const s3Error = new Error('Access Denied to S3 bucket')
    mockCountBucketObjects.mockRejectedValue(s3Error)

    const result = await getYears.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(statusCodes.internalServerError)
    expect(result.output.payload.message).toBe('S3 service is currently unavailable')
    expect(h.response).not.toHaveBeenCalled()
  })

  it('should log S3 error when countBucketObjects fails', async () => {
    const s3Error = new Error('Bucket not found')
    mockCountBucketObjects.mockRejectedValue(s3Error)

    const result = await getYears.handler(request, h)

    expect(result.isBoom).toBe(true)
  })

  it('should call controller with database and logger after S3 check passes', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    mockGetYearsController.mockResolvedValue({
      success: true,
      count: 2,
      years: [
        { id: '2023', year: 2023, yearIsLive: true }
      ]
    })

    await getYears.handler(request, h)

    expect(mockGetYearsController).toHaveBeenCalledWith(request.db, request.logger)
  })

  it('should return controller result on success', async () => {
    const controllerResult = {
      success: true,
      count: 3,
      years: [
        { id: '2023', year: 2023, yearIsLive: true },
        { id: '2022', year: 2022, yearIsLive: false },
        { id: '2021', year: 2021, yearIsLive: false }
      ]
    }
    mockCountBucketObjects.mockResolvedValue(8)
    mockGetYearsController.mockResolvedValue(controllerResult)

    await getYears.handler(request, h)

    expect(h.response).toHaveBeenCalledWith(controllerResult)
    expect(responseBuilder.code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('should return 200 status code on successful years fetch', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    mockGetYearsController.mockResolvedValue({
      success: true,
      count: 0,
      years: []
    })

    await getYears.handler(request, h)

    expect(responseBuilder.code).toHaveBeenCalledWith(200)
  })

  it('should return error when controller throws', async () => {
    mockCountBucketObjects.mockResolvedValue(5)
    const controllerError = new Error('Database connection failed')
    mockGetYearsController.mockRejectedValue(controllerError)

    const result = await getYears.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(500)
    expect(result.output.payload.message).toBe('Failed to fetch years')
    expect(h.response).not.toHaveBeenCalled()
  })

  it('should not call controller if S3 check fails', async () => {
    mockCountBucketObjects.mockRejectedValue(new Error('S3 error'))

    const result = await getYears.handler(request, h)

    expect(mockGetYearsController).not.toHaveBeenCalled()
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
    mockGetYearsController.mockResolvedValue({ success: true, count: 0, years: [] })

    await getYears.handler(request, h)

    expect(mockCountBucketObjects).toHaveBeenCalledWith('production-bucket', 'reports/')
  })

  it('should have correct route configuration', () => {
    expect(getYears.method).toBe('GET')
    expect(getYears.path).toBe('/years')
    expect(getYears.options.tags).toContain('api')
    expect(getYears.options.tags).toContain('years')
  })

  it('should include description in route options', () => {
    expect(getYears.options.description).toBe(
      'Verifies S3 connection health, then retrieves all years from the database'
    )
  })

  it('should return empty years array when controller returns no results', async () => {
    mockCountBucketObjects.mockResolvedValue(0)
    mockGetYearsController.mockResolvedValue({
      success: true,
      count: 0,
      years: []
    })

    await getYears.handler(request, h)

    const response = h.response.mock.calls[0][0]
    expect(response.years).toEqual([])
    expect(response.count).toBe(0)
  })

  it('should handle S3 file count of zero', async () => {
    mockCountBucketObjects.mockResolvedValue(0)
    mockGetYearsController.mockResolvedValue({
      success: true,
      count: 2,
      years: []
    })

    await getYears.handler(request, h)

    expect(request.log).toHaveBeenCalledWith(
      ['info', 's3'],
      'S3 connection OK (test-bucket). Files found: 0'
    )
  })

  it('should use correct status code constant for errors', async () => {
    request.db = null

    const result = await getYears.handler(request, h)

    expect(result.output.statusCode).toBe(statusCodes.internalServerError)
  })
})
