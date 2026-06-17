// Business logic for S3 operations

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'

const logger = createLogger()

// Constants
const PRESIGNED_URL_EXPIRY_SECONDS = 9000 // 150 minutes

// Initialize the S3 Client.
// it will automatically inherit permissions from the IAM Task Role.
const s3Client = new S3Client({
  region: config.get('s3.region') || 'us-east-1'
})

/**
 * Counts objects within a specific S3 bucket
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
    logger.error(error, 'Failed to count S3 objects')
    throw new Error(`Failed to count S3 objects: ${error.message}`)
  }
}

/**
 * Generates a presigned download link for a PRTR dataset file
 * @param {string} bucketName - The name of the S3 bucket
 * @param {number} year - The year of the dataset to download
 * @returns {Promise<string>} - A presigned URL for downloading the file
 */
export const generatePresignedReportDownloadLink = async (
  bucketName,
  year
) => {
  try {
    const fileKey = `reports/uk_prtr_dataset_${year}.xml`

    const downloadCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey
    })

    // Generate a temporary download link (expires in 150 mins)
    const presignedUrl = await getSignedUrl(s3Client, downloadCommand, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS
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
