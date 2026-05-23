import { Queue, Worker, ConnectionOptions } from 'bullmq';
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
