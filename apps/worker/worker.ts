import { Worker, Queue, Job as BullJob } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import dotenv from 'dotenv';
import { AgentController, GenerationParams, VariantResult } from './orchestrator';

// Removed explicit __dirname declaration since CJS provides it automatically.

let envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  envPath = path.resolve(process.cwd(), '../../.env');
}
dotenv.config({ path: envPath });

const logger = pino({ name: 'chromacraft-worker' });
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Redis connection
// ---------------------------------------------------------------------------

let redisHost = process.env.REDIS_HOST || 'localhost';
let redisPort = Number(process.env.REDIS_PORT) || 6379;
let redisPassword = process.env.REDIS_PASSWORD || undefined;

if (process.env.REDIS_URL) {
  try {
    const parsed = new URL(process.env.REDIS_URL);
    redisHost = parsed.hostname;
    redisPort = Number(parsed.port) || 6379;
    if (parsed.password) {
      redisPassword = parsed.password;
    }
  } catch (e) {
    console.warn('Failed to parse REDIS_URL, using defaults');
  }
}

const redisConfig = {
  host: redisHost,
  port: redisPort,
  password: redisPassword,
};

// ---------------------------------------------------------------------------
// Standard UC1 colors
// ---------------------------------------------------------------------------

export const UC1_STANDARD_COLORS = [
  'White', 'Black', 'Blue', 'Red', 'Green', 'Brown',
  'Silver', 'Yellow', 'Cream', 'Pink', 'Dark Blue', 'Orange',
] as const;

// ---------------------------------------------------------------------------
// Job data interfaces
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// BullMQ queue
// ---------------------------------------------------------------------------

const processingQueue = new Queue('processing', { connection: redisConfig as any });

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

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
  const scriptPath = path.join(process.cwd(), 'python', scriptName);
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

// ---------------------------------------------------------------------------
// Register assets produced by the ReAct loop into the database
// ---------------------------------------------------------------------------

async function registerVariantAssets(
  jobId: number,
  results: VariantResult[],
): Promise<void> {
  for (const result of results) {
    if (!result.assetPath || !fs.existsSync(result.assetPath)) {
      continue;
    }
    await prisma.asset.create({
      data: {
        jobId,
        type: 'variant',
        path: result.assetPath,
        // Mark as 'done' if the judge passed; 'error' if all retries were exhausted.
        status: result.passed ? 'done' : 'error',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

logger.info('Initializing workers...');

// 1. Upload Worker — unchanged; marks upload asset done and awaits generate trigger
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
  { connection: redisConfig as any },
);

// 2. Generate Worker — drives the AgentController ReAct loop
const generateWorker = new Worker(
  'generate',
  async (job: BullJob<GenerateJobData>) => {
    const { jobId, prompt, provider, apiKey, settings } = job.data;
    logger.info({ jobId, provider }, 'Starting ReAct generation loop');

    try {
      const dbJob = await prisma.job.findUnique({
        where: { id: jobId },
        include: { assets: true },
      });
      if (!dbJob) {
        throw new Error(`Job ${jobId} not found`);
      }

      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'PROCESSING' },
      });

      const { jobAssetDir } = resolveJobStoragePaths(jobId);
      fs.mkdirSync(jobAssetDir, { recursive: true });

      const colors: string[] =
        settings?.colors?.length ? settings.colors : [...UC1_STANDARD_COLORS];
      const prefix = deriveFilenamePrefix(dbJob.name, settings);

      const refAsset = dbJob.assets.find((a) => a.type === 'original');
      const refImagePath = refAsset?.path ?? undefined;

      // Goal construction: drives the judge's evaluation criteria
      const goal = `Generate a photorealistic product catalog image with the correct paint color.
The image must clearly display the vehicle in the specified color with studio lighting and a clean background.
Job: ${dbJob.name} | Prefix: ${prefix}`;

      const generationParams: GenerationParams = {
        provider,
        apiKey: apiKey || 'none',
        outDir: jobAssetDir,
        refImagePath,
      };

      // Run the ReAct loop via AgentController
      const controller = new AgentController(prisma);
      const results = await controller.run(jobId, goal, generationParams, colors, prompt);

      // Register all produced files as Asset records
      await registerVariantAssets(jobId, results);

      const producedCount = results.filter((r) => r.assetPath).length;
      if (producedCount === 0) {
        throw new Error('ReAct loop completed but no asset files were produced');
      }

      // Enqueue post-processing (rembg, resize, catalog naming)
      await processingQueue.add('process-catalog-variants', {
        jobId,
        prefix,
      } satisfies ProcessingJobData);

      const passedCount = results.filter((r) => r.passed).length;
      logger.info(
        { jobId, prefix, producedCount, passedCount, totalColors: colors.length },
        'ReAct generation complete; enqueued post-processing',
      );

      return { success: true, producedCount, passedCount };
    } catch (err) {
      await markJobFailed(jobId, 'generateWorker', err);
      throw err;
    }
  },
  { connection: redisConfig as any },
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
  { connection: redisConfig as any },
);

// ---------------------------------------------------------------------------
// Graceful shutdown & logging
// ---------------------------------------------------------------------------

[uploadWorker, generateWorker, processingWorker].forEach(worker => {
  worker.on('error', err => {
    logger.error({ err: err.message }, 'BullMQ Worker Error');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Job failed');
  });
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down workers...');
  await uploadWorker.close();
  await generateWorker.close();
  await processingWorker.close();
  await processingQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});

logger.info('Workers initialized successfully. Listening for jobs...');

// Keep event loop alive if BullMQ connection fails silently
setInterval(() => {}, 1000 * 60 * 60);
