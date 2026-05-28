import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { uploadQueue } from '../../../../lib/bullmq';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  try {
    // Rate limit check

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

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (jobId && color) {
      const numericJobId = Number(jobId);
      const safeColor = color.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();

      // Verify job belongs to user
      const job = await prisma.job.findFirst({
        where: { id: numericJobId, userId: Number(userId) },
      });
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      // Save to storage/assets/<jobId>/raw_<color>.png
      const baseStorageDir = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');
      const jobAssetDir = path.join(baseStorageDir, 'assets', String(numericJobId));
      await mkdir(jobAssetDir, { recursive: true });

      const filename = `raw_${safeColor}.png`;
      const filePath = path.join(jobAssetDir, filename);

      await writeFile(filePath, buffer);

      // Create Asset in db
      const asset = await prisma.asset.create({
        data: {
          type: 'variant',
          path: filePath,
          status: 'done',
          jobId: numericJobId,
        },
      });

      return NextResponse.json({ success: true, asset }, { status: 201 });
    }

    // Save to local storage
    const baseStorage = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');
    const storageDir = path.join(baseStorage, 'uploads');
    await mkdir(storageDir, { recursive: true });

    const fileExt = path.extname(file.name) || '.png';
    const filename = `${uuidv4()}${fileExt}`;
    const filePath = path.join(storageDir, filename);

    await writeFile(filePath, buffer);

    // Create Job and Asset in db
    const job = await prisma.job.create({
      data: {
        name: name || file.name || 'Upload Job',
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
      include: {
        assets: true,
      },
    });

    const originalAsset = job.assets.find(a => a.type === 'original');

    // Enqueue job in BullMQ
    await uploadQueue.add('process-upload', {
      jobId: job.id,
      assetId: originalAsset?.id,
      filePath,
      filename,
    });

    return NextResponse.json({ success: true, job }, { status: 201 });
  } catch (err: any) {
    console.error('Upload API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
