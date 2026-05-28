import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';

const s3Enabled = Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);

const s3 = s3Enabled
  ? new S3Client({
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
      forcePathStyle: true,
    })
  : null;

const bucket = process.env.S3_BUCKET || 'chromacraft';

export async function uploadFile(localPath: string, key: string): Promise<string> {
  if (!s3 || s3Enabled === false) {
    return localPath; // local fallback
  }

  const fileBuffer = await fs.promises.readFile(localPath);
  const contentType = key.endsWith('.png')
    ? 'image/png'
    : key.endsWith('.mp4')
      ? 'video/mp4'
      : key.endsWith('.gif')
        ? 'image/gif'
        : key.endsWith('.zip')
          ? 'application/zip'
          : 'application/octet-stream';

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  }));

  return key;
}

export async function getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  if (!s3) {
    return key; // return path for local storage
  }

  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
}

export async function uploadJobAssets(jobId: number, localDir: string): Promise<string[]> {
  if (!s3) return [];

  const keys: string[] = [];
  const files = fs.readdirSync(localDir);

  for (const file of files) {
    const localPath = path.join(localDir, file);
    const stat = fs.statSync(localPath);
    if (stat.isFile()) {
      const key = `jobs/${jobId}/${file}`;
      await uploadFile(localPath, key);
      keys.push(key);
    }
  }

  return keys;
}

export function getLocalStoragePath(): string {
  return process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');
}
