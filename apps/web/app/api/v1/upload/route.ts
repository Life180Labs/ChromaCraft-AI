import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { uploadQueue } from '../../../../lib/bullmq';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');

// Maximum upload size: 25 MB
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// Allowed image MIME types and their magic byte signatures
const ALLOWED_SIGNATURES: { mime: string; bytes: number[]; offset: number }[] = [
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 },
  // JPEG: FF D8 FF
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF], offset: 0 },
  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
];

/**
 * Validate file type by inspecting magic bytes (not just extension/content-type header).
 * Returns the detected MIME type or null if unsupported.
 */
function detectImageMime(buffer: Buffer): string | null {
  for (const sig of ALLOWED_SIGNATURES) {
    const slice = buffer.slice(sig.offset, sig.offset + sig.bytes.length);
    if (sig.bytes.every((b, i) => slice[i] === b)) {
      // Extra check for WebP: bytes 8-11 must be "WEBP"
      if (sig.mime === 'image/webp') {
        const webpMarker = buffer.slice(8, 12).toString('ascii');
        if (webpMarker !== 'WEBP') continue;
      }
      return sig.mime;
    }
  }
  return null;
}

/**
 * Validate that a resolved path stays within the storage boundary.
 */
function assertWithinStorage(filePath: string): void {
  const resolvedStorage = path.resolve(STORAGE_PATH);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedStorage + path.sep) && resolvedFile !== resolvedStorage) {
    throw new Error('Access denied: path is outside storage boundary');
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const name = formData.get('name') as string | null;
    const jobId = formData.get('jobId') as string | null;
    const color = formData.get('color') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // ── SECURITY: File size check ────────────────────────────────────────────
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum allowed size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // ── SECURITY: Magic byte validation (not trusting content-type header) ───
    const detectedMime = detectImageMime(buffer);
    if (!detectedMime) {
      return NextResponse.json(
        { error: 'Invalid file type. Only PNG, JPEG, and WebP images are accepted.' },
        { status: 415 },
      );
    }

    // Map MIME to safe extension
    const mimeToExt: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
    };
    const safeExt = mimeToExt[detectedMime] || '.png';

    if (jobId && color) {
      const numericJobId = Number(jobId);
      if (isNaN(numericJobId) || numericJobId <= 0) {
        return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
      }

      const safeColor = color.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();

      // Verify job belongs to user
      const job = await prisma.job.findFirst({
        where: { id: numericJobId, userId: Number(userId) },
      });
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      const baseStorageDir = STORAGE_PATH;
      const jobAssetDir = path.join(baseStorageDir, 'assets', String(numericJobId));
      await mkdir(jobAssetDir, { recursive: true });

      const filename = `raw_${safeColor}.png`;
      const filePath = path.join(jobAssetDir, filename);

      // ── SECURITY: Path boundary check ───────────────────────────────────
      assertWithinStorage(filePath);

      await writeFile(filePath, buffer);

      const asset = await prisma.asset.create({
        data: {
          type: 'variant',
          path: filePath,
          status: 'done',
          jobId: numericJobId,
        },
      });

      return NextResponse.json({ success: true, assetId: asset.id }, { status: 201 });
    }

    // ── Main upload: create job ──────────────────────────────────────────────
    const baseStorage = STORAGE_PATH;
    const storageDir = path.join(baseStorage, 'uploads');
    await mkdir(storageDir, { recursive: true });

    const filename = `${uuidv4()}${safeExt}`;
    const filePath = path.join(storageDir, filename);

    // ── SECURITY: Path boundary check ───────────────────────────────────────
    assertWithinStorage(filePath);

    await writeFile(filePath, buffer);

    // Sanitize job name
    const safeName = (name || file.name || 'Upload Job')
      .replace(/[<>"'&]/g, '')
      .slice(0, 200);

    const job = await prisma.job.create({
      data: {
        name: safeName,
        userId: Number(userId),
        status: 'PENDING',
        assets: {
          create: {
            type: 'original',
            path: filePath,
            status: 'done',
          },
        },
      },
      include: { assets: true },
    });

    const originalAsset = job.assets.find(a => a.type === 'original');

    await uploadQueue.add('process-upload', {
      jobId: job.id,
      assetId: originalAsset?.id,
      filePath,
      filename,
    });

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        name: job.name,
        status: job.status,
        createdAt: job.createdAt,
      },
    }, { status: 201 });
  } catch (err: any) {
    console.error('Upload API Error:', err);
    if (err.message === 'Access denied: path is outside storage boundary') {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
