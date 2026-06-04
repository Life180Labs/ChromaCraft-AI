import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';

const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');

// ── MinIO presigned URL redirect (P3.5) ──────────────────────────────────────
// If MINIO_ENDPOINT is configured, generate a presigned GET URL and redirect.
// This offloads binary file delivery entirely from the Next.js process to MinIO,
// dramatically reducing memory and CPU usage for large video/image files.
// Falls back to local filesystem streaming if MinIO is not configured.

async function getMinioPresignedUrl(
  assetPath: string,
  contentType: string,
): Promise<string | null> {
  const minioEndpoint = process.env.MINIO_ENDPOINT;
  const minioBucket = process.env.MINIO_BUCKET || 'chromacraft';
  const minioAccessKey = process.env.MINIO_ACCESS_KEY;
  const minioSecretKey = process.env.MINIO_SECRET_KEY;

  if (!minioEndpoint || !minioAccessKey || !minioSecretKey) return null;

  try {
    // Lazy-load the official MinIO SDK to avoid bundle bloat
    const { Client } = await import('minio');
    const client = new Client({
      endPoint: new URL(minioEndpoint).hostname,
      port: Number(new URL(minioEndpoint).port) || (minioEndpoint.startsWith('https') ? 443 : 9000),
      useSSL: minioEndpoint.startsWith('https'),
      accessKey: minioAccessKey,
      secretKey: minioSecretKey,
    });

    // Convert local path to MinIO object key
    const resolvedStorage = path.resolve(STORAGE_PATH);
    const objectKey = path.relative(resolvedStorage, path.resolve(assetPath)).replace(/\\/g, '/');

    // Check object exists in MinIO (auto-upload if missing in background)
    try {
      await client.statObject(minioBucket, objectKey);
    } catch {
      // Object not in MinIO yet — upload from local disk
      if (existsSync(assetPath)) {
        await client.fPutObject(minioBucket, objectKey, assetPath, { 'Content-Type': contentType });
      } else {
        return null;
      }
    }

    // Generate a 1-hour presigned URL
    const url = await client.presignedGetObject(minioBucket, objectKey, 3600);
    return url;
  } catch (err: any) {
    console.warn('[MinIO] Presigned URL failed, falling back to local serve:', err.message);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const url = new URL(req.url);
    const assetId = url.searchParams.get('id');
    if (!assetId || isNaN(Number(assetId))) {
      return NextResponse.json({ error: 'Valid asset ID is required' }, { status: 400 });
    }

    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) },
      include: { job: true },
    });

    if (!asset || asset.job.userId !== Number(userId)) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // ── SECURITY: Validate asset path is within storage boundary ─────────────
    const resolvedStorage = path.resolve(STORAGE_PATH);
    const resolvedAsset = path.resolve(asset.path);
    if (!resolvedAsset.startsWith(resolvedStorage + path.sep) && resolvedAsset !== resolvedStorage) {
      console.error(`[Security] Asset ${asset.id} has path outside storage: ${asset.path}`);
      return NextResponse.json({ error: 'Asset unavailable' }, { status: 403 });
    }

    // Determine content type from extension
    const fileExt = path.extname(resolvedAsset).toLowerCase();
    let contentType = 'image/png';
    if (fileExt === '.jpg' || fileExt === '.jpeg') contentType = 'image/jpeg';
    else if (fileExt === '.gif') contentType = 'image/gif';
    else if (fileExt === '.webp') contentType = 'image/webp';
    else if (fileExt === '.mp4') contentType = 'video/mp4';
    else if (fileExt === '.webm') contentType = 'video/webm';
    else if (fileExt === '.mov') contentType = 'video/quicktime';

    // ── MinIO presigned redirect (P3.5) ──────────────────────────────────────
    // If MinIO is configured, redirect to a presigned URL — avoids streaming
    // large binary files through the Next.js process entirely.
    const presignedUrl = await getMinioPresignedUrl(resolvedAsset, contentType);
    if (presignedUrl) {
      return NextResponse.redirect(presignedUrl, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    }

    // ── Local filesystem fallback ─────────────────────────────────────────────
    if (!existsSync(resolvedAsset)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileBuffer = await readFile(resolvedAsset);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileBuffer.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: any) {
    console.error('Assets API Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
