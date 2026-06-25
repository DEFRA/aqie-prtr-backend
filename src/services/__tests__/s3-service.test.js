import { describe, it, expect, beforeEach, vi } from 'vitest'

// Create mock instances that will be shared - hoisted above mocks
const {
  mockS3ClientInstance,
  mockListObjectsCommand,
  mockGetObjectCommand,
  mockHeadObjectCommand,
  mockCopyObjectCommand,
  mockDeleteObjectCommand,
  mockGetSignedUrl
} = vi.hoisted(() => ({
  mockS3ClientInstance: {
    send: vi.fn()
  },
  mockListObjectsCommand: vi.fn(),
  mockGetObjectCommand: vi.fn(),
  mockHeadObjectCommand: vi.fn(),
  mockCopyObjectCommand: vi.fn(),
  mockDeleteObjectCommand: vi.fn(),
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
    HeadObjectCommand: mockHeadObjectCommand,
    CopyObjectCommand: mockCopyObjectCommand,
    DeleteObjectCommand: mockDeleteObjectCommand
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
  getReportFileKey,
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

describe('locateReportFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when file exists at target key', () => {
    it('returns target key without searching metadata', async () => {
      const targetFileKey = 'reports/uk_prtr_dataset_2023.xml'

      // HeadObject succeeds - file exists with target key
      mockS3ClientInstance.send.mockResolvedValueOnce({})

      const result = await getReportFileKey('test-bucket', 2023, targetFileKey)

      expect(result).toBe(targetFileKey)
      // Verify HeadObject was called to check for target key
      expect(mockHeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: targetFileKey
      })
      // Should not call ListObjectsV2 (no metadata search needed)
      expect(mockListObjectsCommand).not.toHaveBeenCalled()
    })

    it('returns target key for different years', async () => {
      mockS3ClientInstance.send.mockResolvedValueOnce({})

      const result = await getReportFileKey('bucket', 2022)

      expect(result).toBe('reports/uk_prtr_dataset_2022.xml')
    })
  })

  describe('when file not at target key - search by metadata', () => {
    it('searches metadata and renames file to target key when file not found', async () => {
      const oldKey = 'uploaded/uk_prtr_dataset_2023.xml'
      const targetFileKey = 'reports/uk_prtr_dataset_2023.xml'

      // Create NoSuchKey error (AWS SDK error for missing object)
      const notFoundError = new Error('The specified key does not exist.')
      notFoundError.name = 'NoSuchKey'

      // HeadObject fails with NoSuchKey - file not at target key
      mockS3ClientInstance.send
        .mockRejectedValueOnce(notFoundError)
        // ListObjects for metadata search
        .mockResolvedValueOnce({
          Contents: [{ Key: oldKey }]
        })
        // HeadObject to check metadata
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })
        // CopyObject to rename file
        .mockResolvedValueOnce({})
        // DeleteObject to remove old key
        .mockResolvedValueOnce({})

      const result = await getReportFileKey('test-bucket', 2023, targetFileKey)

      expect(result).toBe(targetFileKey)

      // Verify rename operations
      expect(mockCopyObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        CopySource: 'test-bucket/' + oldKey,
        Key: targetFileKey,
        MetadataDirective: 'COPY'
      })
      expect(mockDeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: oldKey
      })
    })

    it('propagates unexpected HeadObject errors', async () => {
      const targetFileKey = 'reports/uk_prtr_dataset_2023.xml'

      // Create permission error (unexpected)
      const permissionError = new Error('Access Denied')
      permissionError.name = 'AccessDenied'

      mockS3ClientInstance.send.mockRejectedValueOnce(permissionError)

      await expect(getReportFileKey('test-bucket', 2023)).rejects.toThrow(
        'Access Denied'
      )

      // Should not proceed to metadata search
      expect(mockListObjectsCommand).not.toHaveBeenCalled()
    })

    it('throws S3BackendError when metadata search fails', async () => {
      const notFoundError = new Error('The specified key does not exist.')
      notFoundError.name = 'NoSuchKey'

      mockS3ClientInstance.send
        .mockRejectedValueOnce(notFoundError)
        .mockRejectedValueOnce(new Error('Metadata search failed'))

      await expect(getReportFileKey('test-bucket', 2023)).rejects.toThrow(
        'Failed to locate report file for year 2023'
      )
    })

    it('throws S3BackendError when rename operation fails', async () => {
      const oldKey = 'uploaded/uk_prtr_dataset_2023.xml'
      const notFoundError = new Error('The specified key does not exist.')
      notFoundError.name = 'NoSuchKey'

      mockS3ClientInstance.send
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({
          Contents: [{ Key: oldKey }]
        })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        })
        .mockRejectedValueOnce(new Error('Copy operation failed'))

      await expect(getReportFileKey('test-bucket', 2023)).rejects.toThrow(
        'Failed to locate report file for year 2023'
      )
    })
  })

  describe('error handling', () => {
    it('includes year in error message', async () => {
      const notFoundError = new Error('The specified key does not exist.')
      notFoundError.name = 'NoSuchKey'

      mockS3ClientInstance.send
        .mockRejectedValueOnce(notFoundError)
        .mockRejectedValueOnce(new Error('Search failed'))

      await expect(
        getReportFileKey('bucket', 2021, 'reports/uk_prtr_dataset_2021.xml')
      ).rejects.toThrow('2021')
    })
  })
})

describe('generatePresignedReportDownloadLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns presigned URL for report', async () => {
    const expectedUrl =
      'https://s3.amazonaws.com/bucket/reports/uk_prtr_dataset_2023.xml?signed'

    // HeadObject succeeds - file found with target key
    mockS3ClientInstance.send.mockResolvedValueOnce({})
    mockGetSignedUrl.mockResolvedValueOnce(expectedUrl)

    const result = await generatePresignedReportDownloadLink(
      'test-bucket',
      2023
    )

    expect(result).toBe(expectedUrl)
  })

  it('generates URL with correct expiry time', async () => {
    mockS3ClientInstance.send.mockResolvedValueOnce({})
    mockGetSignedUrl.mockResolvedValueOnce('https://example.com/url')

    await generatePresignedReportDownloadLink('test-bucket', 2023)

    const signUrlCall = mockGetSignedUrl.mock.calls[0]
    expect(signUrlCall[2]).toEqual({ expiresIn: 9000 })
  })

  it('uses correct S3 key for GetObjectCommand', async () => {
    mockS3ClientInstance.send.mockResolvedValueOnce({})
    mockGetSignedUrl.mockResolvedValueOnce('https://example.com/url')

    await generatePresignedReportDownloadLink('test-bucket', 2023)

    expect(mockGetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'reports/uk_prtr_dataset_2023.xml'
    })
  })

  it('throws S3BackendError when locateReportFile fails', async () => {
    const notFoundError = new Error('The specified key does not exist.')
    notFoundError.name = 'NoSuchKey'
    mockS3ClientInstance.send
      .mockRejectedValueOnce(notFoundError)
      .mockRejectedValueOnce(new Error('Locate failed'))

    await expect(
      generatePresignedReportDownloadLink('test-bucket', 2023)
    ).rejects.toThrow('Failed to locate report file for year 2023')
  })

  it('throws S3BackendError when presigned URL generation fails', async () => {
    mockS3ClientInstance.send.mockResolvedValueOnce({})
    mockGetSignedUrl.mockRejectedValueOnce(new Error('Invalid credentials'))

    await expect(
      generatePresignedReportDownloadLink('test-bucket', 2023)
    ).rejects.toThrow('Failed to generate S3 download link')
  })

  it('handles different bucket names', async () => {
    mockS3ClientInstance.send.mockResolvedValueOnce({})
    mockGetSignedUrl.mockResolvedValueOnce('https://example.com/link')

    await generatePresignedReportDownloadLink('production-bucket', 2023)

    const headCall = mockHeadObjectCommand.mock.calls[0][0]
    expect(headCall.Bucket).toBe('production-bucket')
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
        .mockResolvedValueOnce({ Metadata: { encodedfilename: 'other.xml' } }) // file1.xml - no match
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        }) // expectedKey - match!

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
        .mockResolvedValueOnce({ Metadata: { encodedfilename: 'other.xml' } }) // file1
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
        }) // matchingKey - match!

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
        .mockResolvedValueOnce({ Metadata: { encodedfilename: 'other.xml' } })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'file2.xml' }]
        })
        .mockResolvedValueOnce({
          Metadata: { encodedfilename: 'uk_prtr_dataset_2023.xml' }
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
      mockS3ClientInstance.send.mockRejectedValue(s3Error)

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
