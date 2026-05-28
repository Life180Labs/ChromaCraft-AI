import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { generateEvents, processingEvents } from '../../../../lib/bullmq';
import { createAdapter } from '@bull-monitor/root';

/**
 * GET /api/v1/events?jobId=123
 * SSE endpoint for real-time job progress via BullMQ QueueEvents.
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

  const job = await prisma.job.findFirst({
    where: { id: jobId, userId: Number(userId) },
  });
  if (!job) {
    return new NextResponse('Job not found', { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(`data: ${JSON.stringify({
        event: 'connected', jobId, status: job.status, progress: job.progress,
      })}\n\n`);

      const onProgress = ({ jobId: jid, data }: { jobId: string; data: any }) => {
        if (Number(jid) === jobId) {
          controller.enqueue(`data: ${JSON.stringify({ event: 'progress', jobId, ...data })}\n\n`);
        }
      };
      const onCompleted = ({ jobId: jid }: { jobId: string }) => {
        if (Number(jid) === jobId) {
          controller.enqueue(`data: ${JSON.stringify({ event: 'done', jobId, status: 'COMPLETED' })}\n\n`);
          controller.close();
        }
      };
      const onFailed = ({ jobId: jid, failedReason }: { jobId: string; failedReason: string }) => {
        if (Number(jid) === jobId) {
          controller.enqueue(`data: ${JSON.stringify({ event: 'failed', jobId, error: failedReason })}\n\n`);
          controller.close();
        }
      };

      generateEvents.on('progress', onProgress);
      generateEvents.on('completed', onCompleted);
      generateEvents.on('failed', onFailed);
      processingEvents.on('completed', onCompleted);

      req.signal.addEventListener('abort', () => {
        generateEvents.off('progress', onProgress);
        generateEvents.off('completed', onCompleted);
        generateEvents.off('failed', onFailed);
        processingEvents.off('completed', onCompleted);
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
