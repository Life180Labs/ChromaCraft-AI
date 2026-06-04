/**
 * apps/worker/veoWorker.ts
 *
 * BullMQ worker for async Veo video generation.
 * Processes video generation jobs enqueued by generate-direct/route.ts.
 * Polling for Veo operations runs here (not in the web server HTTP request).
 *
 * Queue: 'veo-video'
 * Job data: { jobId, geminiApiKey, imageModel, videoModel, videoPrompt,
 *             refImagePath, refImageMime, videoPath, fallbackSafePrefix, jobAssetDir }
 */

import { Worker, Job as BullJob } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

let envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) envPath = path.resolve(process.cwd(), '../../.env');
dotenv.config({ path: envPath });

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

// ── Veo REST API integration ──────────────────────────────────────────────────

async function generateVideoWithVeo(
  apiKey: string,
  videoPrompt: string,
  imageBase64: string,
  imageMimeType: string,
  videoModel: string,
): Promise<string | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${videoModel}:predictLongRunning?key=${apiKey}`;

  const body = {
    instances: [{ prompt: videoPrompt, image: { bytesBase64Encoded: imageBase64, mimeType: imageMimeType } }],
    parameters: { aspectRatio: '16:9', durationSeconds: 8, sampleCount: 1 },
  };

  console.log(`[VeoWorker] Starting video generation (model: ${videoModel})`);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Veo predictLongRunning failed (${res.status}): ${errText.slice(0, 600)}`);
  }

  const initData = await res.json();
  const operationName = initData?.name;
  if (!operationName) throw new Error(`Veo returned no operation name`);

  console.log(`[VeoWorker] Operation: ${operationName}. Polling...`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
  const MAX_POLLS = 72; // up to 12 minutes
  const POLL_INTERVAL_MS = 10_000;

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) {
      console.warn(`[VeoWorker] Poll ${attempt + 1} failed (${pollRes.status}), retrying...`);
      continue;
    }

    const pollData = await pollRes.json();
    console.log(`[VeoWorker] Poll ${attempt + 1}/${MAX_POLLS}: done=${pollData.done}`);

    if (pollData.done) {
      if (pollData.error) throw new Error(`Veo failed: ${pollData.error.message}`);

      const samples =
        pollData.response?.generateVideoResponse?.generatedSamples ||
        pollData.response?.generatedVideos ||
        pollData.response?.videos || [];

      for (const v of samples) {
        const uri = v?.video?.uri || v?.uri;
        if (uri) return uri;
        const bytes = v?.video?.bytesBase64Encoded || v?.video?.videoBytes;
        if (bytes) return `data:video/mp4;base64,${bytes}`;
      }

      throw new Error(`Veo done but no video in response`);
    }
  }

  throw new Error(`Veo timed out after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`);
}

async function downloadVideoFromUri(apiKey: string, videoUri: string): Promise<Buffer> {
  if (videoUri.startsWith('data:')) {
    return Buffer.from(videoUri.split(',')[1], 'base64');
  }
  const url = videoUri.includes('?')
    ? `${videoUri}&alt=media&key=${apiKey}`
    : `${videoUri}?alt=media&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateFallbackStill(
  apiKey: string,
  imageModel: string,
  videoPrompt: string,
  refImageBase64: string,
  refImageMime: string,
): Promise<Buffer | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ inlineData: { mimeType: refImageMime, data: refImageBase64 } }, { text: `${videoPrompt}. Cinematic product showcase — dramatic studio hero shot with premium lighting.` }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return null;
  const data = await res.json();
  for (const candidate of data?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.inlineData?.mimeType?.startsWith('image/')) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }
  }
  return null;
}

// ── Worker ────────────────────────────────────────────────────────────────────

export const veoVideoWorker = new Worker('veo-video', async (job: BullJob) => {
  const {
    jobId, geminiApiKey, imageModel, videoModel, videoPrompt,
    refImagePath, refImageMime, videoPath, fallbackSafePrefix, jobAssetDir,
  } = job.data;

  console.log(`[VeoWorker] Processing video for job ${jobId}`);

  // Read reference image
  let refImageBuffer: Buffer;
  try {
    refImageBuffer = await fs.promises.readFile(refImagePath);
  } catch (err: any) {
    throw new Error(`Could not read reference image: ${err.message}`);
  }
  const refImageBase64 = refImageBuffer.toString('base64');

  try {
    const startTime = Date.now();
    const videoUri = await generateVideoWithVeo(
      geminiApiKey, videoPrompt, refImageBase64, refImageMime, videoModel,
    );
    if (!videoUri) throw new Error('No video URI returned');

    const downloadStartTime = Date.now();
    const videoBuffer = await downloadVideoFromUri(geminiApiKey, videoUri);
    const downloadLatency = Date.now() - downloadStartTime;
    const totalLatency = Date.now() - startTime;
    await fs.promises.writeFile(videoPath, videoBuffer);

    await prisma.asset.deleteMany({ where: { jobId, type: 'video' } });
    await prisma.asset.create({ data: { jobId, type: 'video', path: videoPath, status: 'done' } });

    // Cost estimation for this specific video based on model selected
    let costPerSecond = 0.35;
    if (videoModel.includes('3.1') || videoModel.includes('3.0')) {
      costPerSecond = (videoModel.includes('preview') || videoModel.includes('lite')) ? 0.05 : 0.35;
    } else if (videoModel.includes('2.0')) {
      costPerSecond = videoModel.includes('preview') ? 0.03 : 0.35;
    }
    const estimatedCostUSD = costPerSecond * 8; // default 8s

    console.log(`[VeoWorker] ✅ Video saved: ${videoPath} (${videoBuffer.length} bytes)`);
    console.log(`[VeoWorker] [COST] Job ${jobId} video completed using model "${videoModel}". Video duration: 8s. Cost per second: $${costPerSecond.toFixed(4)}. Estimated Video Cost: $${estimatedCostUSD.toFixed(4)}. Generation latency: ${(totalLatency / 1000).toFixed(1)}s (download latency: ${(downloadLatency / 1000).toFixed(1)}s).`);
    return { success: true, path: videoPath };
  } catch (err: any) {
    console.error(`[VeoWorker] Veo failed: ${err.message}. Generating fallback still...`);

    // Fallback: generate a showcase still image
    try {
      const fallbackBuffer = await generateFallbackStill(
        geminiApiKey, imageModel, videoPrompt, refImageBase64, refImageMime,
      );
      if (fallbackBuffer) {
        const fallbackPath = path.join(jobAssetDir, `${fallbackSafePrefix}_showcase_still.png`);
        await fs.promises.writeFile(fallbackPath, fallbackBuffer);
        await prisma.asset.deleteMany({ where: { jobId, type: 'video' } });
        await prisma.asset.create({
          data: { jobId, type: 'video', path: fallbackPath, status: 'done' },
        });
        console.log(`[VeoWorker] Fallback still saved: ${fallbackPath}`);
        return { success: true, fallback: true, path: fallbackPath };
      }
    } catch (fallbackErr: any) {
      console.error(`[VeoWorker] Fallback still failed: ${fallbackErr.message}`);
    }

    // Mark video asset as failed — don't fail the whole job
    await prisma.asset.deleteMany({ where: { jobId, type: 'video', status: 'pending' } });
    return { success: false, error: err.message };
  }
}, {
  connection: redisConfig as any,
  concurrency: 2,         // Max 2 concurrent Veo jobs (API rate limit friendly)
  lockDuration: 15 * 60 * 1000, // 15 min lock (Veo can take up to 12 min)
});

veoVideoWorker.on('completed', (job) =>
  console.log(`[VeoWorker] Job ${job.id} completed`)
);
veoVideoWorker.on('failed', (job, err) =>
  console.error(`[VeoWorker] Job ${job?.id} failed: ${err.message}`)
);

process.on('SIGTERM', async () => {
  await veoVideoWorker.close();
  await prisma.$disconnect();
});
