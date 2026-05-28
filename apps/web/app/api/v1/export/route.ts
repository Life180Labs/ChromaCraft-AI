import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import archiver from 'archiver';
import { createReadStream, existsSync } from 'fs';
import { Readable } from 'stream';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';

// Helper to sign export tokens
const SECRET = process.env.NEXTAUTH_SECRET || 'fallback-secret-for-chromacraft-export-token-signing';

function generateSignedToken(jobId: number, expiryMs: number): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + expiryMs;
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(`${jobId}:${expiresAt}`)
    .digest('hex');
  const token = Buffer.from(JSON.stringify({ jobId, expiresAt, signature })).toString('base64');
  return { token, expiresAt };
}

function verifySignedToken(token: string): number | null {
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    const { jobId, expiresAt, signature } = JSON.parse(raw);

    if (Date.now() > expiresAt) return null;

    const expectedSignature = crypto
      .createHmac('sha256', SECRET)
      .update(`${jobId}:${expiresAt}`)
      .digest('hex');

    if (signature === expectedSignature) {
      return Number(jobId);
    }
  } catch (e) {
    console.error('Token verification error:', e);
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const mode = url.searchParams.get('mode') || 'stream'; // stream or url
    const format = url.searchParams.get('format') || 'png';

    let jobId: number | null = null;

    if (token) {
      // Direct access via signed token (no active session check needed)
      jobId = verifySignedToken(token);
      if (!jobId) {
        return NextResponse.json({ error: 'Invalid or expired export URL' }, { status: 400 });
      }
    } else {
      // Session-based access
      const userId = await getUserId(req);
      if (!userId) {
        return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
      }

      const jobIdParam = url.searchParams.get('jobId');
      if (!jobIdParam) {
        return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
      }
      jobId = Number(jobIdParam);

      // Verify ownership
      const job = await prisma.job.findFirst({
        where: { id: jobId, userId: Number(userId) },
      });
      if (!job) {
        return NextResponse.json({ error: 'Job not found or unauthorized' }, { status: 404 });
      }
    }

    // Retrieve assets for job
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { assets: true },
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const approvedAssets = job.assets.filter(a => a.type === 'processed' && a.status === 'approved');

    if (approvedAssets.length === 0) {
      return NextResponse.json({ error: 'No approved assets to export' }, { status: 400 });
    }

    // Mode handling
    if (!token && mode === 'url') {
      const expiry = Number(process.env.EXPORT_URL_EXPIRY_SECONDS || '600') * 1000;
      const { token: signedToken } = generateSignedToken(jobId, expiry);
      const downloadUrl = `${req.nextUrl.origin}/api/v1/export?token=${encodeURIComponent(signedToken)}&format=${format}`;
      return NextResponse.json({ success: true, url: downloadUrl });
    }

    // Otherwise, build and stream zip
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Node Stream to ReadableStream for NextResponse
    const stream = new Readable({
      read() {},
    });

    archive.on('data', (chunk) => stream.push(chunk));
    archive.on('end', () => stream.push(null));
    archive.on('error', (err) => {
      console.error('Archiver error:', err);
      stream.destroy(err);
    });

    // Add files to archive
    for (const asset of approvedAssets) {
      if (existsSync(asset.path)) {
        if (asset.type === 'video' || format === 'original') {
          // Add as-is
          archive.file(asset.path, { name: path.basename(asset.path) });
        } else {
          // Convert using sharp
          try {
            let s = sharp(asset.path);
            if (format === 'jpeg' || format === 'jpg') {
              s = s.jpeg({ quality: 90 });
            } else if (format === 'webp') {
              s = s.webp({ quality: 90 });
            } else {
              s = s.png();
            }
            const buffer = await s.toBuffer();
            const originalName = path.basename(asset.path);
            const baseName = path.parse(originalName).name;
            const ext = format === 'jpeg' ? 'jpg' : format;
            archive.append(buffer, { name: `${baseName}.${ext}` });
          } catch (e) {
            console.error(`Failed to convert ${asset.path}:`, e);
            // Fallback to original
            archive.file(asset.path, { name: path.basename(asset.path) });
          }
        }
      } else {
        console.warn(`File does not exist: ${asset.path}`);
      }
    }

    archive.finalize();

    return new NextResponse(stream as any, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="chromacraft-job-${jobId}.zip"`,
      },
    });
  } catch (err: any) {
    console.error('Export API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
