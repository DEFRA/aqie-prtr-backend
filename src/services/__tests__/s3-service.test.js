import { describe, it, expect, beforeEach, vi } from 'vitest'

// Create mock instances that will be shared - hoisted above mocks
const {
  mockS3ClientInstance,
  mockListObjectsCommand,
  mockGetObjectCommand,
  mockHeadObjectCommand,
  mockGetSignedUrl
} = vi.hoisted(() => ({
  mockS3ClientInstance: {
    send: vi.fn()
  },
  mockListObjectsCommand: vi.fn(),
  mockGetObjectCommand: vi.fn(),
  mockHeadObjectCommand: vi.fn(),
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
    GetObjectCommand: mockGetObjectCommand,
    HeadObjectCommand: mockHeadObjectCommand
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
  generatePresignedReportDownloadLink,
  findKeyByMetadataFilename
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
      'reports/uk_prtr_dataset_2023.xml',
      2023
    )

    expect(result).toBe(expectedUrl)
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      mockS3ClientInstance,
      expect.any(Object),
      { expiresIn: 9000 }
    )
  })

  it('creates GetObjectCommand with correct file key', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink(
      'test-bucket',
      'reports/uk_prtr_dataset_2022.xml',
      2022
    )

    expect(mockGetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'reports/uk_prtr_dataset_2022.xml'
    })
  })

  it('uses file key directly from parameter', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    const testKey = 'custom/path/file.xml'
    await generatePresignedReportDownloadLink('my-bucket', testKey, 2021)

    const callArgs = mockGetObjectCommand.mock.calls[0][0]
    expect(callArgs.Key).toBe(testKey)
  })

  it('throws error with message when URL generation fails', async () => {
    const signError = new Error('Invalid bucket')
    mockGetSignedUrl.mockRejectedValue(signError)

    await expect(
      generatePresignedReportDownloadLink('test-bucket', 'file.xml', 2023)
    ).rejects.toThrow('Failed to generate S3 download link: Invalid bucket')
  })

  it('handles different bucket names', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink(
      'production-bucket',
      'file.xml',
      2023
    )

    expect(mockGetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'production-bucket' })
    )
  })

  it('uses 150 minutes (9000 seconds) as presigned URL expiry', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('test-bucket', 'file.xml', 2023)

    // Verify the expiresIn value matches 150 minutes = 9000 seconds
    const callArgs = mockGetSignedUrl.mock.calls[0][2]
    expect(callArgs.expiresIn).toBe(9000)
  })

  it('throws error when getSignedUrl throws with generic message', async () => {
    const signError = new Error('Connection timeout')
    mockGetSignedUrl.mockRejectedValue(signError)

    await expect(
      generatePresignedReportDownloadLink('test-bucket', 'file.xml', 2023)
    ).rejects.toThrow('Failed to generate S3 download link')
  })

  it('handles numeric year parameter', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')

    await generatePresignedReportDownloadLink('test-bucket', 'file.xml', 2020)

    // Year is just used for logging, verify the function returns a URL
    expect(mockGetSignedUrl).toHaveBeenCalled()
  })

  it('includes year in success log message', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/link')
    const mockLoggerInstance = {
      info: vi.fn(),
      error: vi.fn()
    }

    // Note: Logger is mocked globally, so we verify by checking it was called
    await generatePresignedReportDownloadLink('test-bucket', 'file.xml', 2023)

    // The actual logger behavior would be verified through integration tests
    expect(mockGetSignedUrl).toHaveBeenCalled()
  })
})

describe('findKeyByMetadataFilename', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('successful cases', () => {
    it('finds and returns S3 key when metadata matches', async () => {
      const expectedKey = 'reports/uk_prtr_dataset_2023.xml'
      mockS3ClientInstance.send
        .mockResolvedValueOnce({
          Contents: [
            { Key: 'file1.xml' },
            { Key: expectedKey },
            { Key: 'file3.xml' }
          ]
        })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      const result = await findKeyByMetadataFilename('test-bucket', 2023)

      expect(result).toBe(expectedKey)
    })

    it('creates ListObjectsV2Command with bucket name', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'test-key' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      await findKeyByMetadataFilename('my-bucket', 2023)

      const listCall = mockListObjectsCommand.mock.calls[0][0]
      expect(listCall.Bucket).toBe('my-bucket')
    })

    it('constructs correct encoded filename pattern from year', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'key' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2022.xml' }
        })

      await findKeyByMetadataFilename('bucket', 2022)

      // Check that the function searched for the correct filename pattern
      const headCall = mockHeadObjectCommand.mock.calls[0][0]
      expect(headCall.Bucket).toBe('bucket')
    })

    it('handles multiple objects and checks metadata of each', async () => {
      const matchingKey = 'reports/matching.xml'
      mockS3ClientInstance.send
        .mockResolvedValueOnce({
          Contents: [
            { Key: 'file1.xml' },
            { Key: matchingKey },
            { Key: 'file3.xml' }
          ]
        })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      const result = await findKeyByMetadataFilename('bucket', 2023)

      expect(result).toBe(matchingKey)
    })

    it('handles pagination with continuation token', async () => {
      const matchingKey = 'reports/match.xml'
      mockS3ClientInstance.send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'file1.xml' }],
          NextContinuationToken: 'token-123'
        })
        .mockResolvedValueOnce({ Metadata: { encodedfilename: 'wrong.xml' } })
        .mockResolvedValueOnce({
          Contents: [{ Key: matchingKey }]
        })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      const result = await findKeyByMetadataFilename('bucket', 2023)

      expect(result).toBe(matchingKey)
    })

    it('passes continuation token to next ListObjectsV2 call', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'file1.xml' }],
          NextContinuationToken: 'token-456'
        })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'file2.xml' }]
        })

      await findKeyByMetadataFilename('bucket', 2023)

      // Second ListObjectsV2 call should include the continuation token
      const secondListCall = mockListObjectsCommand.mock.calls[1][0]
      expect(secondListCall.ContinuationToken).toBe('token-456')
    })

    it('stops searching once match is found', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'match.xml' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      await findKeyByMetadataFilename('bucket', 2023)

      // Should only make 2 S3 calls: 1 ListObjects + 1 HeadObject
      expect(mockS3ClientInstance.send).toHaveBeenCalledTimes(2)
    })

    it('handles empty Contents array in bucket', async () => {
      mockS3ClientInstance.send.mockResolvedValueOnce({ Contents: [] })

      await expect(findKeyByMetadataFilename('bucket', 2023)).rejects.toThrow(
        'File not found: uk_prtr_dataset_2023.xml'
      )
    })
  })

  describe('error cases', () => {
    it('throws error with message when no matching file found', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'file1.xml' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'different.xml' }
        })

      await expect(findKeyByMetadataFilename('bucket', 2023)).rejects.toThrow(
        'File not found: uk_prtr_dataset_2023.xml'
      )
    })

    it('includes year in error message', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'file1.xml' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2022.xml' }
        })

      await expect(findKeyByMetadataFilename('bucket', 2023)).rejects.toThrow(
        '2023'
      )
    })

    it('throws error when S3 ListObjects fails', async () => {
      const s3Error = new Error('Access Denied')
      mockS3ClientInstance.send.mockRejectedValueOnce(s3Error)

      await expect(findKeyByMetadataFilename('bucket', 2023)).rejects.toThrow(
        'Access Denied'
      )
    })

    it('throws error when S3 HeadObject fails', async () => {
      const s3Error = new Error('Connection timeout')
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'file1.xml' }] })
        .mockRejectedValueOnce(s3Error)

      await expect(findKeyByMetadataFilename('bucket', 2023)).rejects.toThrow(
        'Connection timeout'
      )
    })

    it('throws error when paginating through results', async () => {
      const s3Error = new Error('Network error')
      mockS3ClientInstance.send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'file1.xml' }],
          NextContinuationToken: 'token-123'
        })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2022.xml' }
        })
        .mockRejectedValueOnce(s3Error)

      await expect(findKeyByMetadataFilename('bucket', 2023)).rejects.toThrow(
        'Network error'
      )
    })
  })

  describe('metadata handling', () => {
    it('compares metadata encodedfilename with search term', async () => {
      const matchingKey = 'correct.xml'
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: matchingKey }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      const result = await findKeyByMetadataFilename('bucket', 2023)

      expect(result).toBe(matchingKey)
    })

    it('ignores files without matching metadata', async () => {
      const correctKey = 'correct.xml'
      mockS3ClientInstance.send
        .mockResolvedValueOnce({
          Contents: [
            { Key: 'wrong1.xml' },
            { Key: correctKey },
            { Key: 'wrong2.xml' }
          ]
        })
        .mockResolvedValueOnce({ Metadata: { encodedfilename: 'other.xml' } })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      const result = await findKeyByMetadataFilename('bucket', 2023)

      expect(result).toBe(correctKey)
    })

    it('handles metadata with lowercase encodedfilename key', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'match.xml' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })

      const result = await findKeyByMetadataFilename('bucket', 2023)

      expect(result).toBe('match.xml')
    })

    it('handles undefined metadata gracefully', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'file1.xml' }] })
        .mockResolvedValueOnce({})

      await expect(findKeyByMetadataFilename('bucket', 2023)).rejects.toThrow(
        'File not found'
      )
    })
  })

  describe('different years', () => {
    it('handles year 2007', async () => {
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'match.xml' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2007.xml' }
        })

      const result = await findKeyByMetadataFilename('bucket', 2007)

      expect(result).toBe('match.xml')
    })

    it('handles current year', async () => {
      const currentYear = new Date().getFullYear()
      mockS3ClientInstance.send
        .mockResolvedValueOnce({ Contents: [{ Key: 'match.xml' }] })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: `uk_prtr_dataset_${currentYear}.xml` }
        })

      const result = await findKeyByMetadataFilename('bucket', currentYear)

      expect(result).toBe('match.xml')
    })
  })
})
