// Business logic for S3 operations

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '#src/config.js'
import { createLogger } from '#src/common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Thrown when S3 operations fail (network, invalid credentials, bucket not found, etc).
 * Lets routes map failures to appropriate HTTP status codes.
 */
export class S3BackendError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'S3BackendError'
    this.status = status ?? null
    if (cause) {
      this.cause = cause
    }
  }
}

// Constants
const PRESIGNED_URL_EXPIRY_SECONDS = 9000 // 150 minutes

// Initialize the S3 Client.
// it will automatically inherit permissions from the IAM Task Role.
const s3Client = new S3Client({
  region: config.get('s3.region')
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
    throw new S3BackendError(`Failed to count S3 objects: ${error.message}`, {
      cause: error
    })
  }
}

//Files are uploaded to S3 with a metadata field called "x-filename" which contains the filename. This function searches for the file in the bucket by checking the metadata of each object.
export const findKeyByMetadataFilename = async (bucketName, year) => {
  const encodedFilename = `uk_prtr_dataset_${year}.xml`

  let continuationToken

  do {
    const { Contents, NextContinuationToken } = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken
      })
    )

    for (const { Key } of Contents || []) {
      const { Metadata } = await s3Client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key
        })
      )

      if (Metadata?.encodedfilename === encodedFilename) {
        return Key // ✅ found match
      }
    }

    continuationToken = NextContinuationToken
  } while (continuationToken)

  throw new Error(`File not found: ${encodedFilename}`)
}

/**
 * Generates a presigned download link for a report for a specific year.
 * Flow:
 * 1. First search for the file using standard filename format: reports/uk_prtr_dataset_${year}.xml
 * 2. If not found, search using metadata filename
 * 3. Once found, rename the S3 key to standard format for future use
 * 4. Generate and return the presigned download link
 * 
 * @param {string} bucketName - The name of the S3 bucket
 * @param {number} year - The year of the report to download
 * @returns {Promise<string>} - A presigned URL for downloading the file
 * @throws {S3BackendError} - If any step fails
 */
export const generatePresignedReportDownloadLink = async (
  bucketName,
  year
) => {
  try {
    // Step 1: Try to find file using standard filename format
    const targetFileKey = `reports/uk_prtr_dataset_${year}.xml`
    let actualFileKey = targetFileKey
    let fileExists = false

    try {
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: targetFileKey
        })
      )
      fileExists = true
      logger.info(`Found file at standard location: ${targetFileKey}`)
    } catch (headError) {
      // File not at standard location, proceed to metadata search
      logger.info(
        `Standard location not found, searching by metadata for year ${year}`
      )
    }

    // Step 2: If not found at standard location, search using metadata
    if (!fileExists) {
      try {
        actualFileKey = await findKeyByMetadataFilename(bucketName, year)
        logger.info(`Found file by metadata search: ${actualFileKey}`)

        // Step 3: Rename the file to standard location for future use
        await renameS3Object(bucketName, actualFileKey, targetFileKey)
        actualFileKey = targetFileKey
        logger.info(`Renamed file to standard location: ${targetFileKey}`)
      } catch (searchError) {
        throw new S3BackendError(
          `Failed to locate report file for year ${year}: ${searchError.message}`,
          { cause: searchError }
        )
      }
    }

    // Step 4: Generate presigned download link
    const downloadCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: actualFileKey
    })

    const presignedUrl = await getSignedUrl(s3Client, downloadCommand, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS
    })

    logger.info(`Successfully generated S3 download link for year ${year}.`)
    return presignedUrl
  } catch (error) {
    // Ensure all errors are thrown as S3BackendError
    if (error instanceof S3BackendError) {
      throw error
    }
    logger.error(error, 'Failed to generate S3 download link')
    throw new S3BackendError(
      `Failed to generate S3 download link: ${error.message}`,
      { cause: error }
    )
  }
}

export const renameS3Object = async (bucketName, oldKey, newKey) => {
  try {
    // Step 1: copy object to new key
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${oldKey}`,
        Key: newKey,
        MetadataDirective: "COPY" // ✅ preserves metadata
      })
    );

    // Step 2: delete the old object
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: oldKey
      })
    );

    logger.info(`Successfully renamed ${oldKey} → ${newKey}`);
  } catch (error) {
    logger.error(error, "Failed to rename S3 object");
    throw new S3BackendError(
      `Failed to rename S3 object: ${error.message}`,
      { cause: error }
    );
  }
};
