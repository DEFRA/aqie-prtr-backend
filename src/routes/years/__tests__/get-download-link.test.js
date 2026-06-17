import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock is hoisted — intercepts the import before get-download-link.js evaluates
vi.mock('#src/config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('#src/services/s3-service.js', () => ({
  generatePresignedReportDownloadLink: vi.fn()
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
    config.get.mockReturnValue('test-bucket')
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

    await getDownloadLink.handler(request, h)

    expect(h.response).toHaveBeenCalledWith({
      success: false,
      message: 'Failed to retrieve download link for year 2023',
      error: 'S3 connection failed'
    })
    expect(responseBuilder.code).toHaveBeenCalledWith(statusCodes.internalServerError)
  })

  it('should return 500 error code on exception', async () => {
    generatePresignedReportDownloadLink.mockRejectedValue(
      new Error('Unexpected error')
    )

    await getDownloadLink.handler(request, h)

    expect(responseBuilder.code).toHaveBeenCalledWith(500)
  })

  it('should include error message in response on failure', async () => {
    const errorMessage = 'Bucket not found'
    generatePresignedReportDownloadLink.mockRejectedValue(
      new Error(errorMessage)
    )

    await getDownloadLink.handler(request, h)

    const responseCall = h.response.mock.calls[0][0]
    expect(responseCall.error).toBe(errorMessage)
  })

  it('should have correct route configuration', () => {
    expect(getDownloadLink.method).toBe('GET')
    expect(getDownloadLink.path).toBe('/years/get-download-link/{year}')
    expect(getDownloadLink.options.tags).toContain('api')
    expect(getDownloadLink.options.tags).toContain('download-links')
  })
})
