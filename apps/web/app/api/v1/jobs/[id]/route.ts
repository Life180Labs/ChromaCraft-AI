import prisma from '../../../../../lib/prisma';
import { getUserId } from '../../../../../lib/auth';
import { NextResponse } from 'next/server';

/**
 * GET /api/v1/jobs/:id
 *
 * Fetches a single job with its FULL assets (including paths for image rendering).
 * Used by the frontend for:
 *   1. Active generation polling (replaces full-list /api/v1/jobs poll)
 *   2. Loading selected job detail for the Generate/Review tabs
 *
 * Unlike GET /api/v1/jobs (list), this includes the full asset record
 * so the UI can render images via /api/v1/assets?id=X.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { id } = await params;
  const jobId = Number(id);
  if (isNaN(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, userId: Number(userId) },
    include: {
      assets: {
        orderBy: { id: 'asc' },
      },
      generation: true,
      prompt: true,
      generationConfig: true,
    },
  });

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  return NextResponse.json(job);
}
