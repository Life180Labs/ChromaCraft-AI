import { Queue, Worker, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

const redisConfig: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

export const connection = new IORedis(redisConfig);

// Define queues
export const uploadQueue = new Queue('upload', { connection });
export const generateQueue = new Queue('generate', { connection });
export const processingQueue = new Queue('processing', { connection });
export const qaQueue = new Queue('qa', { connection });

// Export a worker factory (used in the Node worker)
export const createWorker = (name: string, processor: any) => {
  return new Worker(name, processor, { connection, lockDuration: 900000 }); // 15 min lock
};
