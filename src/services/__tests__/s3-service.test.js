import { describe, it, expect, beforeEach, vi } from 'vitest'

// Create mock instances that will be shared - hoisted above mocks
const {
  mockS3ClientInstance,
  mockListObjectsCommand,
  mockGetObjectCommand,
  mockGetSignedUrl
} = vi.hoisted(() => ({
  mockS3ClientInstance: {
    send: vi.fn()
  },
  mockListObjectsCommand: vi.fn(),
  mockGetObjectCommand: vi.fn(),
  mockGetSignedUrl: vi.fn()
}))

// vi.mock is hoisted — intercepts the import before s3-service.js evaluates
vi.mock('@aws-sdk/client-s3', () => {
  // Return a constructor that returns the mock instance
  class MockS3Client {
    constructor() {
      Object.assign(this, mockS3ClientInstance)
    }
  }
  return {
    S3Client: MockS3Client,
    ListObjectsV2Command: mockListObjectsCommand,
    GetObjectCommand: mockGetObjectCommand
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl
}))

vi.mock('#src/config.js', () => ({
  config: {
    get: vi.fn(() => 'us-east-1')
  }
}))

vi.mock('#src/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn()
  }))
}))

import {
  countBucketObjects,
  generatePresignedReportDownloadLink
} from '#src/services/s3-service.js'

describe('countBucketObjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the count of objects in a bucket', async () => {
    mockS3ClientInstance.send.mockResolvedValue({ KeyCount: 5 })

    const result = await countBucketObjects('test-bucket')

    expect(result).toBe(5)
  })

  it('returns 0 when no objects found', async () => {
    mockS3ClientInstance.send.mockResolvedValue({ KeyCount: 0 })

    const result = await countBucketObjects('test-bucket')

    expect(result).toBe(0)
  })

  it('returns 0 when KeyCount is undefined', async () => {
    mockS3ClientInstance.send.mockResolvedValue({})

    const result = await countBucketObjects('test-bucket')

    expect(result).toBe(0)
  })

  it('creates ListObjectsV2Command with bucket name and prefix', async () => {
    mockS3ClientInstance.send.mockResolvedValue({ KeyCount: 3 })

    await countBucketObjects('my-bucket', 'reports/')

    expect(mockListObjectsCommand).toHaveBeenCalledWith({
      Bucket: 'my-bucket',
      Prefix: 'reports/'
    })
  })

  it('creates ListObjectsV2Command with empty prefix by default', async () => {
    mockS3ClientInstance.send.mockResolvedValue({ KeyCount: 1 })

    await countBucketObjects('my-bucket')

    expect(mockListObjectsCommand).toHaveBeenCalledWith({
      Bucket: 'my-bucket',
      Prefix: ''
    })
  })

  it('throws error with message when S3 operation fails', async () => {
    const s3Error = new Error('Access Denied')
    mockS3ClientInstance.send.mockRejectedValue(s3Error)

    await expect(countBucketObjects('test-bucket')).rejects.toThrow(
      'Failed to count S3 objects: Access Denied'
    )
  })

  it('calls s3Client.send with the ListObjectsV2Command', async () => {
    mockS3ClientInstance.send.mockResolvedValue({ KeyCount: 2 })

    await countBucketObjects('test-bucket')

    expect(mockS3ClientInstance.send).toHaveBeenCalled()
  })
})

describe('generatePresignedReportDownloadLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates presigned URL with correct expiry', async () => {
    const expectedUrl =
      'https://s3.amazonaws.com/bucket/reports/uk_prtr_dataset_2023.xml?signed'
    mockGetSignedUrl.mockResolvedValue(expectedUrl)

    const result = await generatePresignedReportDownloadLink(
      'test-bucket',
      2023
    )

    expect(result).toBe(expectedUrl)
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      mockS3ClientInstance,
      expect.any(Object),
      { expiresIn: 9000 }
    )
  })

  it('creates GetObjectCommand with correct file key for the year', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('test-bucket', 2022)

    expect(mockGetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'reports/uk_prtr_dataset_2022.xml'
    })
  })

  it('formats the file key with the year parameter', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('my-bucket', 2021)

    const callArgs = mockGetObjectCommand.mock.calls[0][0]
    expect(callArgs.Key).toBe('reports/uk_prtr_dataset_2021.xml')
  })

  it('throws error with message when URL generation fails', async () => {
    const signError = new Error('Invalid bucket')
    mockGetSignedUrl.mockRejectedValue(signError)

    await expect(
      generatePresignedReportDownloadLink('test-bucket', 2023)
    ).rejects.toThrow('Failed to generate S3 download link: Invalid bucket')
  })

  it('handles different bucket names', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('production-bucket', 2023)

    expect(mockGetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'production-bucket' })
    )
  })

  it('uses 150 minutes (9000 seconds) as presigned URL expiry', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('test-bucket', 2023)

    // Verify the expiresIn value matches 150 minutes = 9000 seconds
    const callArgs = mockGetSignedUrl.mock.calls[0][2]
    expect(callArgs.expiresIn).toBe(9000)
  })

  it('throws error when getSignedUrl throws with generic message', async () => {
    const signError = new Error('Connection timeout')
    mockGetSignedUrl.mockRejectedValue(signError)

    await expect(
      generatePresignedReportDownloadLink('test-bucket', 2023)
    ).rejects.toThrow('Failed to generate S3 download link')
  })

  it('handles numeric year parameter', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('test-bucket', 2020)

    const callArgs = mockGetObjectCommand.mock.calls[0][0]
    expect(callArgs.Key).toContain('2020')
  })

  it('handles string year parameter', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('test-bucket', '2023')

    const callArgs = mockGetObjectCommand.mock.calls[0][0]
    expect(callArgs.Key).toContain('2023')
  })
})
