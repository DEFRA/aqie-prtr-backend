// Business logic for S3 operations

// Upload documents
// Download documents
// Delete objects
// Similar pattern to your existing location-service.js

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'

const logger = createLogger()

// Initialize the S3 Client.
// If running on AWS (ECS, EKS, Lambda), leave the object empty {};
// it will automatically inherit permissions from the IAM Task Role.
const s3Client = new S3Client({
  region: config.get('s3.region')
})

/**
 * Lists objects within a specific S3 bucket
 * @param {string} bucketName - The name of the S3 bucket
 * @param {string} [prefix] - Optional folder path/prefix to filter by
 * @returns {Promise<number>} - Number of objects found
 */
export const countBucketObjects = async (bucketName, prefix = '') => {
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix
  })

  try {
    const response = await s3Client.send(command)
    return response.KeyCount ?? 0
  } catch (error) {
    logger.error(error, 'Failed to list S3 contents')
    throw new Error(`Failed to list S3 contents: ${error.message}`)
  }
}

export const generatePresignedDownloadLink = async (
  bucketName,
  year,
  prefix = 'reports'
) => {
  try {
    const normalizedPrefix = prefix.replace(/\/$/, '')
    const fileKey = normalizedPrefix
      ? `${normalizedPrefix}/uk_prtr_dataset_${year}.xml`
      : `uk_prtr_dataset_${year}.xml`

    const downloadCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey
    })

    // Generate a temporary download link (expires in 150 mins)
    const presignedUrl = await getSignedUrl(s3Client, downloadCommand, {
      expiresIn: 9000
    })

    logger.info(
      `Successfully generated S3 download link for year ${year}, presigned URL: ${presignedUrl}`
    )
    return presignedUrl
  } catch (error) {
    logger.error(error, 'Failed to generate S3 download link')
    throw new Error(`Failed to generate S3 download link: ${error.message}`)
  }
}
