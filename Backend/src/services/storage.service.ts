import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const s3 = new S3Client({
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  ...(config.s3.endpoint && { endpoint: config.s3.endpoint }),
});

export class StorageService {

  // Upload a file buffer to S3
  async uploadBuffer(buffer: Buffer, mimeType: string, folder = 'uploads'): Promise<string> {
    const ext = mimeType.split('/')[1] || 'bin';
    const key = `${folder}/${uuidv4()}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }));

    logger.info(`File uploaded to S3`, { key });
    return key;
  }

  // Upload from a URL (download then re-upload to our S3)
  async uploadFromUrl(sourceUrl: string, folder = 'outputs'): Promise<{ key: string; url: string }> {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Failed to fetch from URL: ${sourceUrl}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'video/mp4';
    const key = await this.uploadBuffer(buffer, contentType, folder);
    const url = await this.getSignedUrl(key);
    return { key, url };
  }

  // Generate a signed URL for temporary access (1 hour default)
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
    });
    return getSignedUrl(s3, command, { expiresIn });
  }

  // Get permanent public URL (only if bucket is public — not recommended)
  getPublicUrl(key: string): string {
    if (config.s3.endpoint) {
      return `${config.s3.endpoint}/${config.s3.bucketName}/${key}`;
    }
    return `https://${config.s3.bucketName}.s3.${config.s3.region}.amazonaws.com/${key}`;
  }
}

export const storageService = new StorageService();
