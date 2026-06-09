// Business logic for S3 operations

// Upload documents
// Download documents
// Delete objects
// Similar pattern to your existing location-service.js

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

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
    Prefix: prefix, // TODO:Use this if you only want to see files inside a specific "folder" , folder might be better for future different uploads
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
