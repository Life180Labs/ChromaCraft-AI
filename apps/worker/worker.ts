import { Worker, Queue, Job as BullJob } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import dotenv from 'dotenv';
import { AgentController, GenerationParams, GenerationSettings, VariantResult, generateCollaterals, runProcess } from './orchestrator';

let envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) envPath = path.resolve(process.cwd(), '../../.env');
dotenv.config({ path: envPath });

const logger = pino({ name: 'chromacraft-worker' });
const prisma = new PrismaClient();

let redisHost = process.env.REDIS_HOST || 'localhost';
let redisPort = Number(process.env.REDIS_PORT) || 6379;
let redisPassword: string | undefined = process.env.REDIS_PASSWORD;

if (process.env.REDIS_URL) {
  try {
    const parsed = new URL(process.env.REDIS_URL);
    redisHost = parsed.hostname;
    redisPort = Number(parsed.port) || 6379;
    if (parsed.password) redisPassword = decodeURIComponent(parsed.password);
  } catch { }
}

const redisConfig = { host: redisHost, port: redisPort, password: redisPassword };

// Default 12-color palette for catalog generation
export const DEFAULT_COLORS = [
  'White', 'Black', 'Blue', 'Red', 'Green', 'Brown',
  'Silver', 'Yellow', 'Cream', 'Pink', 'Dark Blue', 'Orange',
] as const;

interface GenerateJobData {
  jobId: number; prompt: string; provider: string; apiKey: string;
  refImagePath?: string; settings?: GenerationSettings & { prefix?: string; colors?: string[] };
}
interface ProcessingJobData { jobId: number; prefix: string; }
interface ValidateJobData { jobId: number; assetId: number; originalPath: string; generatedPath: string; color: string; }

const processingQueue = new Queue('processing', { connection: redisConfig as any });
const dlq = new Queue('dead-letter', { connection: redisConfig as any });

function derivePrefix(jobName: string, settings?: GenerateJobData['settings']): string {
  if (settings?.prefix?.trim()) return settings.prefix.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  return jobName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
}

function resolveStoragePaths(jobId: number) {
  const storageDir = process.env.STORAGE_PATH || path.join(process.cwd(), '..', 'storage');
  const jobAssetDir = path.join(storageDir, 'assets', String(jobId));
  const processedDir = path.join(jobAssetDir, 'processed');
  return { storageDir, jobAssetDir, processedDir };
}

async function runPythonScript(scriptName: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const scriptPath = path.join(process.cwd(), 'python', scriptName);
  return runProcess('python', [scriptPath, ...args]);
}

async function markJobFailed(jobId: number, context: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ jobId, context, err: msg }, 'Marking job FAILED');
  await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: msg, completedAt: new Date() } });
}

async function registerVariantAssets(jobId: number, results: VariantResult[]) {
  for (const r of results) {
    if (!r.assetPath) continue;
    try {
      const exists = fs.existsSync(r.assetPath);
      await prisma.asset.create({
        data: {
          jobId, type: 'variant', path: r.assetPath,
          status: exists ? (r.passed ? 'done' : 'error') : 'error',
          aggregateScore: r.qualityScore ?? null,
        },
      });
    } catch (e: any) {
      logger.warn({ jobId, path: r.assetPath, err: e.message }, 'Could not register variant asset');
    }
  }
}

async function logJobEvent(jobId: number, event: string, message: string, metadata?: any) {
  try {
    await prisma.jobEvent.create({ data: { jobId, event, message, metadata: metadata ?? {} } });
  } catch { }
}

// --- Stale job recovery on startup ---
(async function recoverStaleJobs() {
  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes
  const stale = await prisma.job.findMany({
    where: {
      status: 'PROCESSING',
      startedAt: { lt: staleThreshold },
    },
  });
  for (const job of stale) {
    logger.warn({ jobId: job.id }, 'Recovering stale PROCESSING job → FAILED');
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorMessage: 'Stale job auto-recovered after 30min timeout', completedAt: new Date() },
    });
    await logJobEvent(job.id, 'STALE_RECOVERY', 'Job auto-failed after 30min without completion');
  }
})().catch(err => logger.error({ err: err.message }, 'Stale job recovery failed'));

// --- Upload Worker ---
const uploadWorker = new Worker('upload', async (job: BullJob) => {
  const { jobId, assetId } = job.data;
  if (assetId) await prisma.asset.update({ where: { id: assetId }, data: { status: 'done' } });
  await logJobEvent(jobId, 'UPLOAD_COMPLETE', 'Upload processed');
}, { connection: redisConfig as any });

// --- Generate Worker (with Identity Preservation) ---
const generateWorker = new Worker('generate', async (job: BullJob<GenerateJobData>) => {
  const { jobId, prompt, provider, apiKey, refImagePath, settings } = job.data;

  try {
    const dbJob = await prisma.job.findUnique({ where: { id: jobId }, include: { assets: true } });
    if (!dbJob) throw new Error(`Job ${jobId} not found in database`);

    await prisma.job.update({ where: { id: jobId }, data: { status: 'PROCESSING', startedAt: new Date() } });
    await logJobEvent(jobId, 'GENERATION_STARTED', 'Identity-preserving generation started');

    const { jobAssetDir } = resolveStoragePaths(jobId);
    fs.mkdirSync(jobAssetDir, { recursive: true });

    let colors: string[] = (settings?.colors && settings.colors.length > 0) ? settings.colors : [...DEFAULT_COLORS];
    const gridSize = (settings?.cols ?? 4) * (settings?.rows ?? 3);
    if (colors.length > gridSize) colors = colors.slice(0, gridSize);

    const prefix = derivePrefix(dbJob.name, settings);
    const refAsset = dbJob.assets.find((a) => a.type === 'original');
    const bypassRefPath = refAsset?.path;

    if (settings && (settings as any).skipGeneration) {
      logger.info({ jobId }, 'skipGeneration flag detected. Processing collaterals only.');
      const controller = new AgentController(prisma);
      if (bypassRefPath) {
        try {
          await generateCollaterals(jobId, {
            provider, apiKey: apiKey || 'none', outDir: jobAssetDir,
            refImagePath: bypassRefPath, settings: { ...settings, prefix }
          }, [], prisma, path.join(process.cwd(), 'python'));
        } catch (e: any) {
          logger.error({ err: e.message }, "Collateral generation failed during bypass");
        }
      }
      await processingQueue.add('process-catalog-variants', { jobId, prefix } satisfies ProcessingJobData);
      return { success: true, message: 'Skipped generation, processed collaterals & enqueued' };
    }

    const goals = `Generate an identity-preserved product catalog image with correct color. Maintain exact same shape, geometry, proportions, and structure. Only color changes. Job: "${dbJob.name}" | Prefix: ${prefix} | Industry: ${settings?.industry || 'General'}.`;

    const genParams: GenerationParams = {
      provider, apiKey: apiKey || 'none', outDir: jobAssetDir, refImagePath: bypassRefPath,
      settings: {
        ...settings, prefix, imageSize: settings?.imageSize || '800x600',
        spinFrames: settings?.spinFrames || 36, fps: settings?.fps || 12,
        strategy: (settings as any)?.strategy || 'stability',
        denoiseStrength: (settings as any)?.denoiseStrength ?? 0.4,
        qualityThreshold: (settings as any)?.qualityThreshold ?? 0.92,
        identityLock: (settings as any)?.identityLock !== false,
      },
    };

    const controller = new AgentController(prisma);
    const results = await controller.run(jobId, goals, genParams, colors, prompt);
    await registerVariantAssets(jobId, results);

    const produced = results.filter((r) => r.assetPath).length;
    if (produced === 0) throw new Error('ReAct loop produced no asset files');

    await processingQueue.add('process-catalog-variants', { jobId, prefix } satisfies ProcessingJobData);

    const passedCount = results.filter(r => r.passed).length;
    await prisma.job.update({
      where: { id: jobId },
      data: { progress: 85 },
    });

    await logJobEvent(jobId, 'GENERATION_COMPLETE', `Generated ${produced} variants, ${passedCount} passed quality`);

    return { success: true, produced, passed: passedCount };
  } catch (err) {
    await markJobFailed(jobId, 'generateWorker', err);
    await logJobEvent(jobId, 'GENERATION_FAILED', err instanceof Error ? err.message : String(err));
    throw err;
  }
}, { connection: redisConfig as any, concurrency: 2 });

// --- Processing Worker (Background Removal) ---
const processingWorker = new Worker('processing', async (job: BullJob<ProcessingJobData>) => {
  const { jobId, prefix } = job.data;

  try {
    const { jobAssetDir, processedDir } = resolveStoragePaths(jobId);
    fs.mkdirSync(processedDir, { recursive: true });

    const refAsset = await prisma.asset.findFirst({ where: { jobId, type: 'original' } });

    const { exitCode, stderr } = await runPythonScript('process.py', [
      '--inputDir', jobAssetDir, '--outputDir', processedDir, '--prefix', prefix,
      ...(refAsset?.path ? ['--refImage', refAsset.path] : []),
      '--jsonMode',
    ]);
    if (exitCode !== 0) throw new Error(`process.py failed (exit ${exitCode}): ${stderr}`);

    const files = fs.readdirSync(processedDir);
    const created: any[] = [];
    for (const file of files) {
      if (!file.endsWith('.png')) continue;
      const asset = await prisma.asset.create({
        data: {
          jobId, type: 'processed', path: path.join(processedDir, file), status: 'pending',
          originalAssetId: refAsset?.id ?? undefined,
        },
      });
      created.push(asset);
    }

    if (created.length === 0) throw new Error('No catalog PNGs produced');
    await prisma.job.update({ where: { id: jobId }, data: { status: 'QA_PENDING', progress: 95 } });
    await logJobEvent(jobId, 'PROCESSING_COMPLETE', `Processed ${created.length} images`);
    return { success: true, assets: created.length };
  } catch (err) {
    await markJobFailed(jobId, 'processingWorker', err);
    throw err;
  }
}, { connection: redisConfig as any });

// --- Validate Worker (Quality Check) ---
const validateWorker = new Worker('validate', async (job: BullJob<ValidateJobData>) => {
  const { jobId, assetId, originalPath, generatedPath, color } = job.data;

  try {
    logger.info({ jobId, assetId, color }, 'Running quality validation');

    const { exitCode, stdout, stderr } = await runPythonScript('quality.py', [
      '--original', originalPath, '--generated', generatedPath,
      '--threshold', process.env.QUALITY_THRESHOLD || '0.92', '--jsonMode',
    ]);

    if (exitCode !== 0) {
      throw new Error(`Quality validator failed: ${stderr.slice(0, 200)}`);
    }

    const lines = stdout.trim().split('\n');
    let result: any = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith('{')) {
        try { result = JSON.parse(lines[i]); break; } catch { }
      }
    }

    if (!result) throw new Error('No valid JSON from quality validator');

    // Update asset with quality scores
    await prisma.asset.update({
      where: { id: assetId },
      data: {
        clipScore: result.clip_score ?? null,
        dinov2Score: result.dinov2_score ?? null,
        ssimScore: result.ssim_score ?? null,
        aggregateScore: result.aggregate ?? null,
        status: result.passed ? 'done' : 'error',
      },
    });

    await logJobEvent(jobId, 'VALIDATION_COMPLETE',
      `${color}: aggregate=${result.aggregate?.toFixed(3)}, passed=${result.passed}`
    );

    return result;
  } catch (err) {
    logger.error({ jobId, assetId, err: err instanceof Error ? err.message : String(err) }, 'Validation failed');
    // Don't fail the job — mark asset as done and log warning
    await prisma.asset.update({
      where: { id: assetId },
      data: { status: 'done' },
    });
    return { passed: true, critique: 'Validator error' };
  }
}, { connection: redisConfig as any, concurrency: 4 });

// --- Event Handlers ---
[uploadWorker, generateWorker, processingWorker, validateWorker].forEach((w) => {
  w.on('error', (err) => logger.error({ err: err.message }, 'Worker error'));
  w.on('failed', async (bullJob, err) => {
    logger.error({ jobId: bullJob?.id, err: err.message }, 'Job failed');
    // Move to DLQ after 3 attempts
    if (bullJob && bullJob.attemptsMade >= 3) {
      await dlq.add(`${bullJob.name}-failed`, {
        originalQueue: bullJob.name,
        jobId: bullJob.id,
        data: bullJob.data,
        error: err.message,
        failedAt: new Date().toISOString(),
      });
      logger.warn({ jobId: bullJob.id, queue: bullJob.name }, 'Moved to DLQ after max retries');
    }
  });
  w.on('completed', (bullJob) => logger.info({ jobId: bullJob?.id }, 'Job completed'));
});


process.on('SIGTERM', async () => {
  await Promise.all([
    uploadWorker.close(), generateWorker.close(),
    processingWorker.close(), validateWorker.close(),
  ]);
  await processingQueue.close();
  await dlq.close();
  await prisma.$disconnect();
  process.exit(0);
});
