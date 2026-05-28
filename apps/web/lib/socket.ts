import { Server as HTTPServer } from 'http';
import { Server } from 'socket.io';
import { generateEvents } from './bullmq';

let io: Server | null = null;

export function initializeSocket(httpServer: HTTPServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // BullMQ events → Socket.IO broadcast
  generateEvents.on('progress', ({ jobId, data }: { jobId: string; data: any }) => {
    io?.to(`job:${jobId}`).emit('job:progress', { jobId: Number(jobId), ...data });
  });

  generateEvents.on('completed', ({ jobId }: { jobId: string }) => {
    io?.to(`job:${jobId}`).emit('job:completed', { jobId: Number(jobId) });
  });

  generateEvents.on('failed', ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
    io?.to(`job:${jobId}`).emit('job:failed', { jobId: Number(jobId), error: failedReason });
  });

  // Process events
  const { processingEvents } = require('./bullmq');
  processingEvents.on('completed', ({ jobId }: { jobId: string }) => {
    io?.to(`job:${jobId}`).emit('processing:completed', { jobId: Number(jobId) });
  });

  io.on('connection', (socket) => {
    socket.on('subscribe:job', (jobId: number) => {
      socket.join(`job:${jobId}`);
    });

    socket.on('unsubscribe:job', (jobId: number) => {
      socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', () => {
      // cleanup
    });
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

/**
 * SSE endpoint helper for environments without WebSocket support.
 * Usage: GET /api/v1/events?jobId=123
 */
export function createSSEStream(jobId: number, onData: (data: string) => void): () => void {
  const handler = (data: any) => {
    onData(`data: ${JSON.stringify(data)}\n\n`);
  };

  io?.to(`job:${jobId}`).on('job:progress', handler);
  io?.to(`job:${jobId}`).on('job:completed', handler);
  io?.to(`job:${jobId}`).on('job:failed', handler);

  return () => {
    // cleanup
  };
}
