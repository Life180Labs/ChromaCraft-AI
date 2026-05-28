import { Queue, QueueEvents, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

let redisHost = process.env.REDIS_HOST || 'localhost';
let redisPort = Number(process.env.REDIS_PORT) || 6379;
let redisPassword = process.env.REDIS_PASSWORD || undefined;

if (process.env.REDIS_URL) {
  try {
    const parsed = new URL(process.env.REDIS_URL);
    redisHost = parsed.hostname;
    redisPort = Number(parsed.port) || 6379;
    if (parsed.password) {
      redisPassword = decodeURIComponent(parsed.password);
    }
  } catch (e) {
    console.warn('Failed to parse REDIS_URL, using defaults');
  }
}

const redisConfig: ConnectionOptions = {
  host: redisHost,
  port: redisPort,
  password: redisPassword,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export const connection = new IORedis(redisConfig);

// Define queues
export const uploadQueue = new Queue('upload', { connection });
export const generateQueue = new Queue('generate', { connection });
export const processingQueue = new Queue('processing', { connection });
export const qaQueue = new Queue('qa', { connection });
export const validateQueue = new Queue('validate', { connection });
export const exportQueue = new Queue('export', { connection });
export const dlq = new Queue('dead-letter', { connection });

// Queue events for real-time progress
export const uploadEvents = new QueueEvents('upload', { connection });
export const generateEvents = new QueueEvents('generate', { connection });
export const processingEvents = new QueueEvents('processing', { connection });

// Worker factory with DLQ and retry support
export const createResilientWorker = (
  name: string,
  processor: (job: any) => Promise<any>,
  opts?: { concurrency?: number },
) => {
  const worker = new Worker(name, processor, {
    connection,
    lockDuration: 15 * 60 * 1000, // 15 min
    maxStalledCount: 3,
    concurrency: opts?.concurrency || 1,
  });

  worker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= 3) {
      await dlq.add(`${name}-failed`, {
        originalQueue: name,
        jobId: job.id,
        data: job.data,
        error: err.message,
        failedAt: new Date().toISOString(),
      });
      console.warn(`[DLQ] Job ${job.id} moved to dead-letter queue after 3 attempts`);
    }
  });

  return worker;
};

export const createWorker = (name: string, processor: any) => {
  return new Worker(name, processor, { connection, lockDuration: 900000 });
};
