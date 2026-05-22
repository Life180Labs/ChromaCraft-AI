import { Worker, Job as BullJob } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import dotenv from 'dotenv';

dotenv.config();

const logger = pino({ name: 'chromacraft-worker' });
const prisma = new PrismaClient();

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

logger.info('Initializing workers...');

// 1. Upload Worker
const uploadWorker = new Worker(
  'upload',
  async (job: BullJob) => {
    const { jobId, assetId, filePath, filename } = job.data;
    logger.info(`Processing upload for job ${jobId}`);

    // Update asset status
    if (assetId) {
      await prisma.asset.update({
        where: { id: assetId },
        data: { status: 'done' },
      });
    }

    // Auto-advance to generate queue if a prompt was pre-defined
    const dbJob = await prisma.job.findUnique({
      where: { id: jobId },
      include: { prompt: true },
    });

    if (dbJob?.prompt) {
      logger.info(`Auto-triggering generation for job ${jobId}`);
      // In a real flow, the frontend will call the generate API route.
      // If we want to auto-trigger, we could do it here. For now, we wait for user.
    }
  },
  { connection: redisConfig as any }
);

// 2. Generate Worker (Spawns Python scripts)
const generateWorker = new Worker(
  'generate',
  async (job: BullJob) => {
    const { jobId, prompt, provider, apiKey, settings } = job.data;
    logger.info(`Starting generation for job ${jobId} via ${provider}`);

    try {
      // Ensure job exists and status is PROCESSING
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'PROCESSING' },
      });

      // Target path for generated outputs
      const storageDir = process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
      const jobAssetDir = path.join(storageDir, 'assets', String(jobId));
      fs.mkdirSync(jobAssetDir, { recursive: true });

      // Run Python script
      const scriptPath = path.join(__dirname, 'python', 'generate.py');
      const numVariants = settings?.numVariants || 4;

      logger.info(`Spawning Python process: ${scriptPath}`);
      const pythonProcess = spawn('python', [
        scriptPath,
        '--jobId', String(jobId),
        '--prompt', prompt,
        '--provider', provider,
        '--apiKey', apiKey,
        '--outDir', jobAssetDir,
        '--num', String(numVariants),
      ]);

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const exitCode = await new Promise((resolve) => {
        pythonProcess.on('close', resolve);
      });

      if (exitCode !== 0) {
        logger.error(`Python script failed with code ${exitCode}. Error: ${stderr}`);
        throw new Error(`Python generation script failed: ${stderr}`);
      }

      logger.info(`Python generation script completed successfully.`);
      logger.debug(`Script output: ${stdout}`);

      // Read output folder to discover generated variant files
      const files = fs.readdirSync(jobAssetDir);
      const createdAssets = [];

      for (const file of files) {
        if (file.startsWith('variant_')) {
          const filePath = path.join(jobAssetDir, file);
          const asset = await prisma.asset.create({
            data: {
              jobId: Number(jobId),
              type: 'variant',
              path: filePath,
              status: 'pending', // pending QA review
            },
          });
          createdAssets.push(asset);
        }
      }

      // Update Job status to QA_PENDING
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'QA_PENDING' },
      });

      return { success: true, assets: createdAssets };
    } catch (err: any) {
      logger.error(`Error in generation worker: ${err.message}`);
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  },
  { connection: redisConfig as any }
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down workers...');
  await uploadWorker.close();
  await generateWorker.close();
  await prisma.$disconnect();
  process.exit(0);
});
