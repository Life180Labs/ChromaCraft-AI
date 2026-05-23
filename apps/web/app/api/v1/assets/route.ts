import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const url = new URL(req.url);
    const assetId = url.searchParams.get('id');
    if (!assetId) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 });
    }

    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) },
      include: { job: true },
    });

    if (!asset || asset.job.userId !== Number(userId)) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    if (!existsSync(asset.path)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    const fileBuffer = readFileSync(asset.path);
    const fileExt = path.extname(asset.path).toLowerCase();
    let contentType = 'image/png';
    if (fileExt === '.jpg' || fileExt === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (fileExt === '.gif') {
      contentType = 'image/gif';
    } else if (fileExt === '.webp') {
      contentType = 'image/webp';
    }

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: any) {
    console.error('Assets API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
