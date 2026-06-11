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
 * @returns {Promise<Array>} - Array of object metadata
 */
export const listBucketContents = async (bucketName, prefix = '') => {
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix // TODO:Use this if you only want to see files inside a specific "folder" , folder might be better for future different uploads
  })

  try {
    const response = await s3Client.send(command)

    // response.Contents contains the array of files
    if (!response.Contents) {
      return []
    }

    // Map the response to return a clean list of file details
    return response.Contents.map((file) => ({
      key: file.Key, // The file path/name
      lastModified: file.LastModified,
      size: file.Size // In bytes
    }))
  } catch (error) {
    // Integrate this with your structured logging (hapi-pino) in your actual route
    throw new Error(`Failed to list S3 contents: ${error.message}`)
  }
}

export const getDownloadLinksAndSaveToDB = async (db, bucketName) => {
  try {
    const listCommand = new ListObjectsV2Command({ Bucket: bucketName })
    const s3Response = await s3Client.send(listCommand)
    const files = s3Response.Contents || []

    for (const [index, file] of files.entries()) {
      const downloadCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: file.Key
      })

      // Generate a temporary download link (expires in 150 mins)
      const presignedUrl = await getSignedUrl(s3Client, downloadCommand, {
        expiresIn: 9000
      })

      await db
        .collection('Years')
        .updateOne(
          { yearID: index + 1 },
          { $set: { downloadLink: presignedUrl } }
        )
    }
  } catch (error) {
    throw new Error(
      `Failed to generate and save S3 download links: ${error.message}`
    )
  }
}
