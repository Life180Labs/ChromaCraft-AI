import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';

/**
 * GET /api/v1/events?jobId=123
 * SSE endpoint for real-time job progress.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const jobId = Number(url.searchParams.get('jobId'));
  if (!jobId) {
    return new NextResponse('jobId required', { status: 400 });
  }

  // Verify ownership
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId: Number(userId) },
  });
  if (!job) {
    return new NextResponse('Job not found', { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send initial state
      controller.enqueue(`data: ${JSON.stringify({
        event: 'connected',
        jobId,
        status: job.status,
        progress: job.progress,
      })}\n\n`);

      // Poll DB for updates (every 1.5s as fallback, SSE keeps connection open)
      let lastProgress = job.progress;
      let lastStatus = job.status;

      const interval = setInterval(async () => {
        try {
          const current = await prisma.job.findUnique({
            where: { id: jobId },
            select: { status: true, progress: true, errorMessage: true },
          });

          if (!current) {
            controller.enqueue(`data: ${JSON.stringify({ event: 'error', message: 'Job not found' })}\n\n`);
            clearInterval(interval);
            controller.close();
            return;
          }

          const changed = current.progress !== lastProgress || current.status !== lastStatus;
          if (changed) {
            lastProgress = current.progress;
            lastStatus = current.status;

            controller.enqueue(`data: ${JSON.stringify({
              event: 'progress',
              jobId,
              status: current.status,
              progress: current.progress,
              errorMessage: current.errorMessage,
            })}\n\n`);

            if (['COMPLETED', 'FAILED', 'QA_PENDING'].includes(current.status)) {
              clearInterval(interval);
              controller.enqueue(`data: ${JSON.stringify({
                event: 'done',
                jobId,
                status: current.status,
              })}\n\n`);
              controller.close();
            }
          }
        } catch {
          clearInterval(interval);
          controller.close();
        }
      }, 1500);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
