import { Worker, Queue, Job as BullJob } from 'bullmq';
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

/** UC1 standard automotive catalog colors per BRD. */
export const UC1_STANDARD_COLORS = [
  'White',
  'Black',
  'Blue',
  'Red',
  'Green',
  'Brown',
  'Silver',
  'Yellow',
  'Cream',
  'Pink',
  'Dark Blue',
  'Orange',
] as const;

interface GenerateJobData {
  jobId: number;
  prompt: string;
  provider: string;
  apiKey: string;
  settings?: {
    prefix?: string;
    colors?: string[];
  };
}

interface ProcessingJobData {
  jobId: number;
  prefix: string;
}

interface PythonRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface JobStoragePaths {
  storageDir: string;
  jobAssetDir: string;
  processedDir: string;
}

const processingQueue = new Queue('processing', { connection: redisConfig as any });

function deriveFilenamePrefix(jobName: string, settings?: GenerateJobData['settings']): string {
  if (settings?.prefix?.trim()) {
    return settings.prefix.trim().replace(/\s+/g, '_');
  }
  return jobName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
}

function resolveJobStoragePaths(jobId: number): JobStoragePaths {
  const storageDir = process.env.STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
  const jobAssetDir = path.join(storageDir, 'assets', String(jobId));
  const processedDir = path.join(jobAssetDir, 'processed');
  return { storageDir, jobAssetDir, processedDir };
}

async function runPythonScript(scriptName: string, args: string[]): Promise<PythonRunResult> {
  const scriptPath = path.join(__dirname, 'python', scriptName);
  logger.info({ scriptPath, args }, 'Spawning Python process');

  const pythonProcess = spawn('python', [scriptPath, ...args]);

  let stdout = '';
  let stderr = '';

  pythonProcess.stdout.on('data', (data: Buffer) => {
    const chunk = data.toString();
    stdout += chunk;
    logger.debug({ scriptName, stream: 'stdout' }, chunk.trim());
  });

  pythonProcess.stderr.on('data', (data: Buffer) => {
    const chunk = data.toString();
    stderr += chunk;
    logger.warn({ scriptName, stream: 'stderr' }, chunk.trim());
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    pythonProcess.on('close', resolve);
  });

  return { exitCode, stdout, stderr };
}

async function markJobFailed(jobId: number, context: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ jobId, context, err: message }, 'Job failed');
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'FAILED' },
  });
}

logger.info('Initializing workers...');

// 1. Upload Worker
const uploadWorker = new Worker(
  'upload',
  async (job: BullJob) => {
    const { jobId, assetId } = job.data;
    logger.info({ jobId }, 'Processing upload');

    if (assetId) {
      await prisma.asset.update({
        where: { id: assetId },
        data: { status: 'done' },
      });
    }

    const dbJob = await prisma.job.findUnique({
      where: { id: jobId },
      include: { prompt: true },
    });

    if (dbJob?.prompt) {
      logger.info({ jobId }, 'Prompt pre-defined; awaiting generate API trigger');
    }
  },
  { connection: redisConfig as any }
);

// 2. Generate Worker — spawns generate.py and enqueues post-processing
const generateWorker = new Worker(
  'generate',
  async (job: BullJob<GenerateJobData>) => {
    const { jobId, prompt, provider, apiKey, settings } = job.data;
    logger.info({ jobId, provider }, 'Starting generation');

    try {
      const dbJob = await prisma.job.findUnique({ where: { id: jobId } });
      if (!dbJob) {
        throw new Error(`Job ${jobId} not found`);
      }

      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'PROCESSING' },
      });

      const { jobAssetDir } = resolveJobStoragePaths(jobId);
      fs.mkdirSync(jobAssetDir, { recursive: true });

      const colors = settings?.colors?.length ? settings.colors : [...UC1_STANDARD_COLORS];
      const prefix = deriveFilenamePrefix(dbJob.name, settings);
      const colorsArg = colors.join(',');

      const { exitCode, stderr } = await runPythonScript('generate.py', [
        '--jobId', String(jobId),
        '--prompt', prompt,
        '--provider', provider,
        '--apiKey', apiKey,
        '--outDir', jobAssetDir,
        '--colors', colorsArg,
      ]);

      if (exitCode !== 0) {
        throw new Error(`Python generation script failed (exit ${exitCode}): ${stderr}`);
      }

      logger.info({ jobId }, 'Python generation completed; registering raw assets');

      const files = fs.readdirSync(jobAssetDir);
      const createdAssets = [];

      for (const file of files) {
        if (!file.startsWith('raw_') || !file.endsWith('.png')) {
          continue;
        }

        const filePath = path.join(jobAssetDir, file);
        const asset = await prisma.asset.create({
          data: {
            jobId,
            type: 'variant',
            path: filePath,
            status: 'pending',
          },
        });
        createdAssets.push(asset);
      }

      if (createdAssets.length === 0) {
        throw new Error('Generation completed but no raw_{color}.png files were produced');
      }

      await processingQueue.add('process-catalog-variants', {
        jobId,
        prefix,
      } satisfies ProcessingJobData);

      logger.info({ jobId, prefix, assetCount: createdAssets.length }, 'Enqueued post-processing job');

      return { success: true, assets: createdAssets, prefix };
    } catch (err) {
      await markJobFailed(jobId, 'generateWorker', err);
      throw err;
    }
  },
  { connection: redisConfig as any }
);

// 3. Processing Worker — rembg, resize, rename; sets QA_PENDING on success
const processingWorker = new Worker(
  'processing',
  async (job: BullJob<ProcessingJobData>) => {
    const { jobId, prefix } = job.data;
    logger.info({ jobId, prefix }, 'Starting post-processing');

    try {
      const { jobAssetDir, processedDir } = resolveJobStoragePaths(jobId);
      fs.mkdirSync(processedDir, { recursive: true });

      const { exitCode, stderr } = await runPythonScript('process.py', [
        '--inputDir', jobAssetDir,
        '--outputDir', processedDir,
        '--prefix', prefix,
      ]);

      if (exitCode !== 0) {
        throw new Error(`Python processing script failed (exit ${exitCode}): ${stderr}`);
      }

      logger.info({ jobId }, 'Python processing completed; registering processed assets');

      const files = fs.readdirSync(processedDir);
      const createdAssets = [];

      for (const file of files) {
        if (!file.startsWith(`${prefix}_`) || !file.endsWith('.png')) {
          continue;
        }

        const filePath = path.join(processedDir, file);
        const asset = await prisma.asset.create({
          data: {
            jobId,
            type: 'processed',
            path: filePath,
            status: 'pending',
          },
        });
        createdAssets.push(asset);
      }

      if (createdAssets.length === 0) {
        throw new Error('Processing completed but no catalog PNG files were produced');
      }

      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'QA_PENDING' },
      });

      logger.info({ jobId, assetCount: createdAssets.length }, 'Job ready for QA review');

      return { success: true, assets: createdAssets };
    } catch (err) {
      await markJobFailed(jobId, 'processingWorker', err);
      throw err;
    }
  },
  { connection: redisConfig as any }
);

process.on('SIGTERM', async () => {
  logger.info('Shutting down workers...');
  await uploadWorker.close();
  await generateWorker.close();
  await processingWorker.close();
  await processingQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});
