import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import archiver from 'archiver';
import { createReadStream, existsSync, readdirSync, statSync } from 'fs';
import { Readable } from 'stream';
import crypto from 'crypto';
import path from 'path';

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
    if (signature === expectedSignature) return Number(jobId);
  } catch { }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const mode = url.searchParams.get('mode') || 'stream';
    const format = url.searchParams.get('format') || 'png';

    let jobId: number | null = null;

    if (token) {
      jobId = verifySignedToken(token);
      if (!jobId) {
        return NextResponse.json({ error: 'Invalid or expired export URL' }, { status: 400 });
      }
    } else {
      const userId = await getUserId(req);
      if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

      const jobIdParam = url.searchParams.get('jobId');
      if (!jobIdParam) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
      jobId = Number(jobIdParam);

      const job = await prisma.job.findFirst({ where: { id: jobId, userId: Number(userId) } });
      if (!job) return NextResponse.json({ error: 'Job not found or unauthorized' }, { status: 404 });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { assets: true },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    const approvedAssets = job.assets.filter(a => a.type === 'processed' && a.status === 'approved');
    if (approvedAssets.length === 0) {
      return NextResponse.json({ error: 'No approved assets to export' }, { status: 400 });
    }

    if (!token && mode === 'url') {
      const expiry = Number(process.env.EXPORT_URL_EXPIRY_SECONDS || '600') * 1000;
      const { token: signedToken } = generateSignedToken(jobId, expiry);
      const downloadUrl = `${req.nextUrl.origin}/api/v1/export?token=${encodeURIComponent(signedToken)}&format=${format}`;
      return NextResponse.json({ success: true, url: downloadUrl });
    }

    // Build ZIP with proper folder structure
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new Readable({ read() {} });

    archive.on('data', (chunk) => stream.push(chunk));
    archive.on('end', () => stream.push(null));
    archive.on('error', (err) => { console.error('Archiver error:', err); stream.destroy(err); });

    const storageDir = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');
    const jobDir = path.join(storageDir, 'assets', String(jobId));

    // Add background-removed images
    const processedDir = path.join(jobDir, 'processed');
    if (existsSync(processedDir)) {
      const files = readdirSync(processedDir).filter(f => f.endsWith('.png'));
      for (const file of files) {
        archive.file(path.join(processedDir, file), { name: `background-removed/${file}` });
      }
    }

    // Add individual variant images
    const variantAssets = job.assets.filter(a => a.type === 'variant' && a.status === 'done');
    for (const asset of variantAssets) {
      if (existsSync(asset.path)) {
        archive.file(asset.path, { name: `individual-images/${path.basename(asset.path)}` });
      }
    }

    // Add grid images
    const gridAssets = job.assets.filter(a => a.type === 'grid' && a.status === 'done');
    for (const asset of gridAssets) {
      if (existsSync(asset.path)) {
        archive.file(asset.path, { name: `merged-grid/${path.basename(asset.path)}` });
      }
    }

    // Add 360 spin assets
    const spinDir = jobDir;
    if (existsSync(spinDir)) {
      const spinFiles = readdirSync(spinDir).filter(
        f => (f.includes('360') || f.includes('spin')) && f.endsWith('.png')
      );
      for (const file of spinFiles) {
        archive.file(path.join(spinDir, file), { name: `360-spin/${file}` });
      }
    }

    // Add videos
    const videoAssets = job.assets.filter(a => a.type === 'video' && a.status === 'done');
    for (const asset of videoAssets) {
      if (existsSync(asset.path)) {
        archive.file(asset.path, { name: `videos/${path.basename(asset.path)}` });
      }
    }

    // Add turntable GIF
    if (existsSync(jobDir)) {
      const gifFiles = readdirSync(jobDir).filter(f => f.endsWith('.gif'));
      for (const file of gifFiles) {
        archive.file(path.join(jobDir, file), { name: `360-spin/${file}` });
      }
    }

    // Add metadata JSON
    const metadata = {
      jobId: job.id,
      name: job.name,
      createdAt: job.createdAt,
      status: job.status,
      assetCount: approvedAssets.length,
      colors: approvedAssets.map(a => path.basename(a.path, '.png').split('_').pop()),
      generatedAt: new Date().toISOString(),
    };
    archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata/job-metadata.json' });

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
