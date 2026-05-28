import { Worker, Queue, Job as BullJob } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import dotenv from 'dotenv';
import { AgentController, GenerationParams, GenerationSettings, VariantResult } from './orchestrator';

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
let redisPassword: string | undefined = process.env.REDIS_PASSWORD;

if (process.env.REDIS_URL) {
  try {
    const parsed = new URL(process.env.REDIS_URL);
    redisHost = parsed.hostname;
    redisPort = Number(parsed.port) || 6379;
    if (parsed.password) redisPassword = decodeURIComponent(parsed.password);
  } catch { /* use defaults */ }
}

const redisConfig = { host: redisHost, port: redisPort, password: redisPassword };

// ---------------------------------------------------------------------------
// Standard UC1 colors (fallback when none configured)
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
  refImagePath?: string;
  settings?: GenerationSettings & { prefix?: string; colors?: string[] };
}

interface ProcessingJobData {
  jobId: number;
  prefix: string;
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

const processingQueue = new Queue('processing', { connection: redisConfig as any });

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function derivePrefix(jobName: string, settings?: GenerateJobData['settings']): string {
  if (settings?.prefix?.trim()) {
    return settings.prefix.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  }
  return jobName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
}

function resolveStoragePaths(jobId: number) {
  const storageDir = process.env.STORAGE_PATH || path.join(process.cwd(), '..', 'storage');
  const jobAssetDir = path.join(storageDir, 'assets', String(jobId));
  const processedDir = path.join(jobAssetDir, 'processed');
  return { storageDir, jobAssetDir, processedDir };
}

async function runPythonScript(
  scriptName: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const scriptPath = path.join(process.cwd(), 'python', scriptName);
  logger.info({ scriptPath, args: args.join(' ') }, 'Spawning Python');
  const proc = spawn('python', [scriptPath, ...args]);
  let stdout = '', stderr = '';
  proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); logger.debug(d.toString().trim()); });
  proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); logger.warn(d.toString().trim()); });
  const exitCode = await new Promise<number | null>((resolve) => { proc.on('close', resolve); });
  return { exitCode, stdout, stderr };
}

async function markJobFailed(jobId: number, context: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ jobId, context, err: msg }, 'Marking job FAILED');
  await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED' } });
}

async function registerVariantAssets(jobId: number, results: VariantResult[]) {
  for (const r of results) {
    if (!r.assetPath) continue;
    try {
      const exists = fs.existsSync(r.assetPath);
      await prisma.asset.create({
        data: {
          jobId,
          type: 'variant',
          path: r.assetPath,
          status: exists ? (r.passed ? 'done' : 'error') : 'error',
        },
      });
    } catch (e: any) {
      logger.warn({ jobId, path: r.assetPath, err: e.message }, 'Could not register variant asset');
    }
  }
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

// 1. Upload worker — mark the original asset as done
const uploadWorker = new Worker(
  'upload',
  async (job: BullJob) => {
    const { jobId, assetId } = job.data;
    logger.info({ jobId }, 'Upload worker: processing');
    if (assetId) {
      await prisma.asset.update({ where: { id: assetId }, data: { status: 'done' } });
    }
  },
  { connection: redisConfig as any },
);

// 2. Generate worker — drives AgentController ReAct loop
const generateWorker = new Worker(
  'generate',
  async (job: BullJob<GenerateJobData>) => {
    const { jobId, prompt, provider, apiKey, refImagePath, settings } = job.data;
    logger.info({ jobId, provider, settings }, 'Generate worker: starting');

    try {
      const dbJob = await prisma.job.findUnique({
        where: { id: jobId },
        include: { assets: true },
      });
      if (!dbJob) throw new Error(`Job ${jobId} not found in database`);

      await prisma.job.update({ where: { id: jobId }, data: { status: 'PROCESSING' } });

      const { jobAssetDir } = resolveStoragePaths(jobId);
      fs.mkdirSync(jobAssetDir, { recursive: true });

      // ── Resolve colors ──
      // Priority: settings.colors from frontend → UC1 defaults
      let colors: string[] = (settings?.colors && settings.colors.length > 0)
        ? settings.colors
        : [...UC1_STANDARD_COLORS];

      // Respect grid dimensions: if cols×rows < colors.length, truncate
      const gridSize = (settings?.cols ?? 4) * (settings?.rows ?? 3);
      if (colors.length > gridSize) {
        colors = colors.slice(0, gridSize);
      }

      const prefix = derivePrefix(dbJob.name, settings);

      // HYBRID GENERATION / FREE TIER BYPASS
      if (settings && (settings as any).skipGeneration) {
        logger.info({ jobId }, 'skipGeneration flag detected. Skipping AI ReAct generation.');
        // Enqueue post-processing directly
        await processingQueue.add('process-catalog-variants', {
          jobId,
          prefix,
        } satisfies ProcessingJobData);
        return { success: true, message: 'Skipped generation, enqueued processing' };
      }

      const refAsset = dbJob.assets.find((a) => a.type === 'original');
      const refImagePath = refAsset?.path;

      // Build image size from grid (target 800×600 per image)
      const imageSize = settings?.imageSize || '800x600';

      // Goal string drives the judge's evaluation
      const goal = [
        `Generate a photorealistic product catalog image with the correct paint color.`,
        `The image must clearly show the product in the specified color with professional studio lighting.`,
        `Clean, pure white background. High quality catalog aesthetic.`,
        `Job: "${dbJob.name}" | Prefix: ${prefix} | Industry: ${settings?.industry || 'General'}.`,
        settings?.targetMarket ? `Target market: ${settings.targetMarket}.` : '',
        settings?.targetAudience ? `Target audience: ${settings.targetAudience}.` : '',
      ].filter(Boolean).join(' ');

      const genParams: GenerationParams = {
        provider,
        apiKey: apiKey || 'none',
        outDir: jobAssetDir,
        refImagePath,
        settings: {
          ...settings,
          prefix,
          imageSize,
          spinFrames: settings?.spinFrames || 36,
          fps: settings?.fps || 12,
        },
      };

      logger.info(
        { jobId, colors: colors.length, prefix, provider, spin: settings?.spinEnabled, video: settings?.videoEnabled },
        'Starting AgentController',
      );

      const controller = new AgentController(prisma);
      const results = await controller.run(jobId, goal, genParams, colors, prompt);

      await registerVariantAssets(jobId, results);

      const produced = results.filter((r) => r.assetPath).length;
      if (produced === 0) throw new Error('ReAct loop produced no asset files');

      // Enqueue post-processing
      await processingQueue.add('process-catalog-variants', {
        jobId,
        prefix,
      } satisfies ProcessingJobData);

      const passed = results.filter((r) => r.passed).length;
      logger.info({ jobId, produced, passed, total: colors.length }, 'Generation complete; enqueued processing');
      return { success: true, produced, passed };
    } catch (err) {
      await markJobFailed(jobId, 'generateWorker', err);
      throw err;
    }
  },
  { connection: redisConfig as any, concurrency: 2 },
);

// 3. Processing worker — rembg, resize, catalog naming → QA_PENDING
const processingWorker = new Worker(
  'processing',
  async (job: BullJob<ProcessingJobData>) => {
    const { jobId, prefix } = job.data;
    logger.info({ jobId, prefix }, 'Processing worker: starting');

    try {
      const { jobAssetDir, processedDir } = resolveStoragePaths(jobId);
      fs.mkdirSync(processedDir, { recursive: true });

      const { exitCode, stderr } = await runPythonScript('process.py', [
        '--inputDir', jobAssetDir,
        '--outputDir', processedDir,
        '--prefix', prefix,
      ]);

      if (exitCode !== 0) {
        throw new Error(`process.py failed (exit ${exitCode}): ${stderr}`);
      }

      logger.info({ jobId }, 'Python processing done; registering processed assets');

      const files = fs.readdirSync(processedDir);
      const created: any[] = [];

      for (const file of files) {
        if (!file.endsWith('.png')) continue;
        const filePath = path.join(processedDir, file);
        const asset = await prisma.asset.create({
          data: { jobId, type: 'processed', path: filePath, status: 'pending' },
        });
        created.push(asset);
      }

      if (created.length === 0) {
        throw new Error('process.py completed but no catalog PNGs produced');
      }

      await prisma.job.update({ where: { id: jobId }, data: { status: 'QA_PENDING' } });
      logger.info({ jobId, assetCount: created.length }, 'Job ready for QA');
      return { success: true, assets: created.length };
    } catch (err) {
      await markJobFailed(jobId, 'processingWorker', err);
      throw err;
    }
  },
  { connection: redisConfig as any },
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

[uploadWorker, generateWorker, processingWorker].forEach((w) => {
  w.on('error', (err) => logger.error({ err: err.message }, 'Worker error'));
  w.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err.message }, 'Job failed'));
  w.on('completed', (job) => logger.info({ jobId: job?.id }, 'Job completed'));
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down workers...');
  await Promise.all([uploadWorker.close(), generateWorker.close(), processingWorker.close()]);
  await processingQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});

logger.info('Workers initialised. Listening for jobs...');
setInterval(() => {}, 1_000 * 60 * 60);
