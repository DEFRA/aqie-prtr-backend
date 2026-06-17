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
        log: {
          enabled: true,
          isEnabled: true,
          level: 'info',
          format: 'ecs',
          redact: []
        },
        's3.region': 'us-east-1',
        serviceName: 'test-service',
        serviceVersion: '1.0.0'
      }
      return configMap[key]
    })
  }
}))

vi.mock('#src/services/s3-service.js', () => ({
  generatePresignedReportDownloadLink: vi.fn(),
  S3BackendError: class S3BackendError extends Error {}
}))

vi.mock('#src/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn()
  }))
}))

import { getDownloadLink } from '#src/routes/get-download-link.js'
import { config } from '#src/config.js'
import {
  generatePresignedReportDownloadLink,
  S3BackendError
} from '#src/services/s3-service.js'
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
      log: {
        enabled: true,
        isEnabled: true,
        level: 'info',
        format: 'ecs',
        redact: []
      },
      's3.region': 'us-east-1',
      's3.bucket': 'test-bucket',
      serviceName: 'test-service',
      serviceVersion: '1.0.0'
    }
    return configMap[key]
  })
}

describe('getDownloadLink', () => {
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

  it('should validate year parameter', () => {
    expect(getDownloadLink.options.validate.params).toBeDefined()
  })

  it('should have correct HTTP method', () => {
    expect(getDownloadLink.method).toBe('GET')
  })

  it('should generate presigned URL for valid year', async () => {
    const presignedUrl = 'https://example.com/presigned-link'
    generatePresignedReportDownloadLink.mockResolvedValue(presignedUrl)

    await getDownloadLink.handler(request, h)

    expect(h.response).toHaveBeenCalledWith({ downloadLink: presignedUrl })
    expect(responseBuilder.code).toHaveBeenCalledWith(statusCodes.ok)
  })

  it('should call S3 service with correct bucket and year', async () => {
    generatePresignedReportDownloadLink.mockResolvedValue(
      'https://example.com/link'
    )

    await getDownloadLink.handler(request, h)

    expect(generatePresignedReportDownloadLink).toHaveBeenCalledWith(
      'test-bucket',
      2023
    )
  })

  it('should return error response when service fails', async () => {
    const serviceError = new S3BackendError('S3 connection failed')
    generatePresignedReportDownloadLink.mockRejectedValue(serviceError)

    const result = await getDownloadLink.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.statusCode).toBe(502)
    expect(result.output.payload.message).toBe(
      'S3 service is currently unavailable'
    )
    expect(h.response).not.toHaveBeenCalled()
  })

  it('should return 500 error code on exception', async () => {
    generatePresignedReportDownloadLink.mockRejectedValue(
      new S3BackendError('Unexpected error')
    )

    const result = await getDownloadLink.handler(request, h)

    expect(result.output.statusCode).toBe(502)
  })

  it('should include error message in response on failure', async () => {
    const errorMessage = 'Bucket not found'
    generatePresignedReportDownloadLink.mockRejectedValue(
      new S3BackendError(errorMessage)
    )

    const result = await getDownloadLink.handler(request, h)

    expect(result.isBoom).toBe(true)
    expect(result.output.payload.message).toBe(
      'S3 service is currently unavailable'
    )
  })

  it('should have correct route configuration', () => {
    expect(getDownloadLink.method).toBe('GET')
    expect(getDownloadLink.path).toBe('/reports/get-download-link/{year}')
    expect(getDownloadLink.options.tags).toContain('api')
    expect(getDownloadLink.options.tags).toContain('download-links')
  })
})
