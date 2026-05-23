import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { limiter } from '../../../../lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    await limiter(req as any, {} as any, () => {});

    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { assetId, status } = await req.json();

    if (!assetId || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'assetId and status (approved/rejected) are required' }, { status: 400 });
    }

    // Find the asset and verify the job belongs to the user
    const asset = await prisma.asset.findUnique({
      where: { id: Number(assetId) },
      include: { job: true },
    });

    if (!asset || asset.job.userId !== Number(userId)) {
      return NextResponse.json({ error: 'Asset not found or unauthorized' }, { status: 404 });
    }

    // Update asset status
    const updatedAsset = await prisma.asset.update({
      where: { id: asset.id },
      data: { status },
    });

    // Check if all processed catalog assets for the job are reviewed
    const allJobAssets = await prisma.asset.findMany({
      where: { jobId: asset.jobId, type: 'processed' },
    });

    const pendingReview = allJobAssets.some(a => a.status === 'pending');

    if (!pendingReview) {
      // Transition job to COMPLETED
      await prisma.job.update({
        where: { id: asset.jobId },
        data: { status: 'COMPLETED' },
      });
    }

    return NextResponse.json({ success: true, asset: updatedAsset });
  } catch (err: any) {
    console.error('QA API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
