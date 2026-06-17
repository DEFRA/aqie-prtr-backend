import { describe, it, expect, beforeEach, vi } from 'vitest'

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

// vi.mock is hoisted — intercepts the import before get-download-link.js evaluates
vi.mock('#src/config.js', () => ({
  config: {
    get: vi.fn((key) => {
      const configMap = {
        'log': {
          enabled: true,
          isEnabled: true,
          level: 'info',
          format: 'ecs',
          redact: []
        },
        's3.region': 'us-east-1',
        'serviceName': 'test-service',
        'serviceVersion': '1.0.0'
      }
      return configMap[key]
    })
  }
}))

vi.mock('#src/services/s3-service.js', () => ({
  generatePresignedReportDownloadLink: vi.fn()
}))

vi.mock('#src/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn()
  }))
}))

import { getDownloadLink } from '#src/routes/years/get-download-link.js'
import { config } from '#src/config.js'
import { generatePresignedReportDownloadLink } from '#src/services/s3-service.js'
import { statusCodes } from '#src/common/constants/status-codes.js'

/**
 * Minimal ResponseToolkit mock supporting the `.response(payload).code(status)` chain.
 */
function buildResponseToolkit() {
  const responseBuilder = { code: vi.fn().mockReturnThis() }
  const h = { response: vi.fn().mockReturnValue(responseBuilder) }
  return { h, responseBuilder }
}

describe('getDownloadLink', () => {
  let request
  let h
  let responseBuilder

  beforeEach(() => {
    vi.clearAllMocks()
    ;({ h, responseBuilder } = buildResponseToolkit())
    config.get.mockImplementation((key) => {
      const configMap = {
        'log': {
          enabled: true,
          isEnabled: true,
          level: 'info',
          format: 'ecs',
          redact: []
        },
        's3.region': 'us-east-1',
        's3.bucket': 'test-bucket',
        'serviceName': 'test-service',
        'serviceVersion': '1.0.0'
      }
      return configMap[key]
    })
    request = {
      params: { year: '2023' },
      log: vi.fn()
    }
  })

  it('should return presigned URL on success', async () => {
    const presignedUrl = 'https://s3.amazonaws.com/test-bucket/reports/2023.pdf?signed'
    generatePresignedReportDownloadLink.mockResolvedValue(presignedUrl)

    await getDownloadLink.handler(request, h)

    expect(h.response).toHaveBeenCalledWith({
      success: true,
      message: 'Download link for year 2023 successfully retrieved',
      downloadLink: presignedUrl
    })
    expect(responseBuilder.code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('should call generatePresignedReportDownloadLink with correct parameters', async () => {
    generatePresignedReportDownloadLink.mockResolvedValue('https://example.com/link')

    await getDownloadLink.handler(request, h)

    expect(config.get).toHaveBeenCalledWith('s3.bucket')
    expect(generatePresignedReportDownloadLink).toHaveBeenCalledWith(
      'test-bucket',
      '2023'
    )
  })

  it('should log successful download link retrieval', async () => {
    generatePresignedReportDownloadLink.mockResolvedValue('https://example.com/link')

    await getDownloadLink.handler(request, h)

    expect(request.log).toHaveBeenCalledWith(
      ['info', 'download-links'],
      'Retrieved download link for year 2023'
    )
  })

  it('should handle different year parameters', async () => {
    generatePresignedReportDownloadLink.mockResolvedValue('https://example.com/link')
    request.params.year = '2022'

    await getDownloadLink.handler(request, h)

    expect(generatePresignedReportDownloadLink).toHaveBeenCalledWith(
      'test-bucket',
      '2022'
    )
    expect(h.response).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Download link for year 2022 successfully retrieved'
      })
    )
  })

  it('should return error response when service fails', async () => {
    const serviceError = new Error('S3 connection failed')
    generatePresignedReportDownloadLink.mockRejectedValue(serviceError)

    const result = await getDownloadLink.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(statusCodes.internalServerError)
    expect(result.output.payload.message).toBe('Failed to retrieve download link')
    expect(h.response).not.toHaveBeenCalled()
  })

  it('should return 500 error code on exception', async () => {
    generatePresignedReportDownloadLink.mockRejectedValue(
      new Error('Unexpected error')
    )

    const result = await getDownloadLink.handler(request, h)

    expect(result.output.statusCode).toBe(statusCodes.internalServerError)
  })

  it('should include error message in response on failure', async () => {
    const errorMessage = 'Bucket not found'
    generatePresignedReportDownloadLink.mockRejectedValue(
      new Error(errorMessage)
    )

    const result = await getDownloadLink.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.payload.message).toBe('Failed to retrieve download link')
  })

  it('should have correct route configuration', () => {
    expect(getDownloadLink.method).toBe('GET')
    expect(getDownloadLink.path).toBe('/years/get-download-link/{year}')
    expect(getDownloadLink.options.tags).toContain('api')
    expect(getDownloadLink.options.tags).toContain('download-links')
  })
})
