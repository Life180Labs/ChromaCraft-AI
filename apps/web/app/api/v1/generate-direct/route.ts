import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { z } from 'zod';
import { decryptApiKey } from '../../../../lib/crypto';
import { veoVideoQueue } from '../../../../lib/bullmq';
import log, { logGenerationCost, logErrorEvent } from '../../../../lib/logger';

const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');

// ── Allowed Gemini model allowlists ──────────────────────────────────────────
const ALLOWED_IMAGE_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.5-flash-preview-05-20',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash',
  'gemini-3.1-pro',
  'gemini-3-pro-image',
  'imagen-3.0-generate-002',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];
const ALLOWED_VIDEO_MODELS = [
  'veo-3.1-generate-001',
  'veo-3.1-generate-preview',
  'veo-3.0-generate-001',
  'veo-3.0-generate-preview',
  'veo-2.0-generate-001',
  'veo-2.0-generate-preview',
];

// ── Input validation schema ───────────────────────────────────────────────────
const GenerateDirectSettingsSchema = z.object({
  colors: z.array(z.string().min(1).max(50)).min(1).max(48).optional(),
  cols: z.number().int().min(1).max(8).optional(),
  rows: z.number().int().min(1).max(8).optional(),
  imageModel: z.string().refine(
    v => ALLOWED_IMAGE_MODELS.includes(v),
    { message: `imageModel must be one of: ${ALLOWED_IMAGE_MODELS.join(', ')}` }
  ).optional(),
  videoModel: z.string().refine(
    v => ALLOWED_VIDEO_MODELS.includes(v),
    { message: `videoModel must be one of: ${ALLOWED_VIDEO_MODELS.join(', ')}` }
  ).optional(),
  videoEnabled: z.boolean().optional(),
  videoPrompt: z.string().max(1000).optional(),
  spinEnabled: z.boolean().optional(),
  cropsEnabled: z.boolean().optional(),
  lifestyleEnabled: z.boolean().optional(),
  industry: z.string().max(100).optional(),
  targetMarket: z.string().max(100).optional(),
  targetAudience: z.string().max(100).optional(),
  targetPurpose: z.string().max(200).optional(),
  additionalContext: z.string().max(2000).optional(),
  prefix: z.string().max(100).optional(),
}).optional();

const GenerateDirectRequestSchema = z.object({
  jobId: z.number().int().positive(),
  prompt: z.string().min(1).max(5000),
  settings: GenerateDirectSettingsSchema,
});

// ── Model Mapper Helpers ───────────────────────────────────────────────────────
function getOptimalImageModel(requestedModel: string): string {
  const modelLower = requestedModel.toLowerCase();
  
  if (modelLower.includes('imagen')) return requestedModel;
  if (modelLower.includes('image-generation') || modelLower.includes('flash-image')) return requestedModel;
  
  if (modelLower.includes('3.1') || modelLower.includes('3.5')) {
     return 'gemini-3-pro-image';
  }
  if (modelLower.includes('2.0') || modelLower.includes('2.5')) {
     return 'gemini-3-pro-image';
  }
  
  return 'gemini-3-pro-image';
}

function getOptimalVideoModel(requestedModel: string): string {
  const modelLower = requestedModel.toLowerCase();
  if (modelLower.includes('veo')) return requestedModel;
  
  if (modelLower.includes('3.1') || modelLower.includes('3.5')) {
      return 'veo-3.1-generate-preview';
  }
  return 'veo-3.1-generate-preview';
}

// ── Security: Storage path boundary check ────────────────────────────────────
function assertWithinStorage(filePath: string): void {
  const resolvedStorage = path.resolve(STORAGE_PATH);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedStorage + path.sep) && resolvedFile !== resolvedStorage) {
    throw new Error('Access denied: path is outside storage boundary');
  }
}

// ─── Gemini image generation helper ──────────────────────────────────────────

async function callGeminiImageAPI(
  apiKey: string,
  model: string,
  promptText: string,
  referenceImageBase64: string,
  referenceImageMime: string,
  maxRetries: number = 3,
): Promise<Buffer | null> {
  let apiModel = model;
  const defaultModel = 'gemini-3-pro-image';

  const body = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: referenceImageMime,
              data: referenceImageBase64,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        const errLower = errText.toLowerCase();

        // If the model is not found or is not supported for generateContent/IMAGE modality, fall back to default
        if (
          apiModel !== defaultModel &&
          (res.status === 404 ||
            res.status === 400 ||
            errLower.includes('not found') ||
            errLower.includes('not supported') ||
            errLower.includes('unsupported') ||
            errLower.includes('invalid') ||
            errLower.includes('modality'))
        ) {
          console.warn(`[callGeminiImageAPI] Model "${apiModel}" failed with error: ${errText.slice(0, 200)}. Falling back to "${defaultModel}"...`);
          apiModel = defaultModel;
          attempt--;
          continue;
        }

        if (res.status === 429 || errLower.includes('quota') || errLower.includes('rate limit')) {
          if (attempt < maxRetries - 1) {
            const sleepMs = (Math.pow(2, attempt) + (Math.random() + 0.5)) * 1000;
            console.log(`   ⏳ [API] Rate limited (429). Backing off ${(sleepMs / 1000).toFixed(1)}s...`);
            await new Promise((resolve) => setTimeout(resolve, sleepMs));
            continue;
          }
        }
        throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 500)}`);
      }

      const data = await res.json();
      const candidates = data?.candidates || [];

      for (const candidate of candidates) {
        if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
          console.warn(`   ⚠️ [API] Gemini finishReason: ${candidate.finishReason}. Safety/prompt details:`, JSON.stringify(candidate.safetyRatings || []));
        }
        for (const part of candidate?.content?.parts || []) {
          if (part?.inlineData?.mimeType?.startsWith('image/')) {
            return Buffer.from(part.inlineData.data, 'base64');
          }
        }
      }

      console.warn(`   ⚠️ [API] Gemini returned no image data on attempt ${attempt + 1}. Full payload:`, JSON.stringify(data));

      // If no image was found and it's not the default model, fall back to default
      if (apiModel !== defaultModel) {
        console.warn(`[callGeminiImageAPI] Model "${apiModel}" did not return an image. Falling back to "${defaultModel}"...`);
        apiModel = defaultModel;
        attempt--;
        continue;
      }

      // Otherwise, if it is already the default model, retry
      if (attempt < maxRetries - 1) {
        const sleepMs = (Math.pow(2, attempt) + (Math.random() + 0.5)) * 1000;
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        continue;
      }
      return null;

    } catch (err: any) {
      const errorMsg = err.message.toLowerCase();
      // If the API call threw a model-related error, fall back to default
      if (
        apiModel !== defaultModel &&
        (errorMsg.includes('404') ||
          errorMsg.includes('400') ||
          errorMsg.includes('not found') ||
          errorMsg.includes('not supported') ||
          errorMsg.includes('unsupported') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('modality'))
      ) {
        console.warn(`[callGeminiImageAPI] Fetch threw for "${apiModel}". Falling back to "${defaultModel}". Error: ${err.message}`);
        apiModel = defaultModel;
        attempt--;
        continue;
      }
      // Rate limit or any other transient network error (like "fetch failed", socket hang up, etc.), retry
      if (attempt < maxRetries - 1) {
        const sleepMs = (Math.pow(2, attempt) + (Math.random() + 0.5)) * 1000;
        console.warn(`   ⏳ [API] Request failed (${err.message}). Retrying in ${(sleepMs / 1000).toFixed(1)}s... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        continue;
      }
      throw err;
    }
  }

  return null;
}

// ─── Color variant generation ─────────────────────────────────────────────────

async function generateColorVariantWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
  referenceImageBase64: string,
  referenceImageMime: string,
  colorName: string,
): Promise<Buffer | null> {
  const colorPrompt = prompt.replace(/\[COLOR\]/gi, colorName).replace(/\[color\]/gi, colorName);
  return callGeminiImageAPI(apiKey, model, colorPrompt, referenceImageBase64, referenceImageMime);
}

// ─── Video generation via Gemini Veo ─────────────────────────────────────────

async function generateVideoWithVeo(
  apiKey: string,
  videoPrompt: string,
  imageBase64: string,
  imageMimeType: string,
  videoModel: string = 'veo-3.1-generate-preview',
): Promise<string | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${videoModel}:predictLongRunning?key=${apiKey}`;

  const body = {
    instances: [
      {
        prompt: videoPrompt,
        image: {
          bytesBase64Encoded: imageBase64,
          mimeType: imageMimeType,
        },
      },
    ],
    parameters: {
      aspectRatio: '16:9',
      durationSeconds: 8,
      sampleCount: 1,
    },
  };

  console.log(`[Video] Starting Veo video generation (model: ${videoModel})`);
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
  if (!operationName) {
    throw new Error(`Veo returned no operation name: ${JSON.stringify(initData).slice(0, 300)}`);
  }

  console.log(`[Video] Operation started: ${operationName}. Polling...`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
  const MAX_POLLS = 60;
  const POLL_INTERVAL_MS = 10_000;

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) {
      console.warn(`[Video] Poll attempt ${attempt + 1} failed (${pollRes.status}), retrying...`);
      continue;
    }

    const pollData = await pollRes.json();
    console.log(`[Video] Poll ${attempt + 1}/${MAX_POLLS}: done=${pollData.done}`);

    if (pollData.done) {
      if (pollData.error) {
        throw new Error(`Veo operation failed: ${pollData.error.message || JSON.stringify(pollData.error)}`);
      }

      const generatedVideos =
        pollData.response?.generateVideoResponse?.generatedSamples ||
        pollData.response?.generatedVideos ||
        pollData.response?.videos ||
        [];

      for (const videoObj of generatedVideos) {
        const videoUri = videoObj?.video?.uri || videoObj?.uri;
        if (videoUri) {
          console.log(`[Video] Complete. URI: ${videoUri}`);
          return videoUri;
        }
        const videoBytes = videoObj?.video?.bytesBase64Encoded || videoObj?.video?.videoBytes;
        if (videoBytes) {
          return `data:video/mp4;base64,${videoBytes}`;
        }
      }

      throw new Error(`Veo done but no video in response: ${JSON.stringify(pollData).slice(0, 500)}`);
    }
  }

  throw new Error(`Veo timed out after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`);
}

async function downloadVideoFromUri(apiKey: string, videoUri: string): Promise<Buffer> {
  if (videoUri.startsWith('data:')) {
    const base64 = videoUri.split(',')[1];
    return Buffer.from(base64, 'base64');
  }

  const downloadUrl = videoUri.includes('?')
    ? `${videoUri}&alt=media&key=${apiKey}`
    : `${videoUri}?alt=media&key=${apiKey}`;

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Video download failed (${res.status}): ${await res.text().then(t => t.slice(0, 300))}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generateVideoWithGemini(
  apiKey: string,
  videoModel: string,
  videoPrompt: string,
  referenceImageBuffer: Buffer,
  referenceImageMime: string,
): Promise<Buffer | null> {
  const imageBase64 = referenceImageBuffer.toString('base64');
  const videoUri = await generateVideoWithVeo(apiKey, videoPrompt, imageBase64, referenceImageMime, videoModel);
  if (!videoUri) return null;
  const videoBuffer = await downloadVideoFromUri(apiKey, videoUri);
  console.log(`[Video] Downloaded successfully (${videoBuffer.length} bytes)`);
  return videoBuffer;
}

// ─── 360 Spin frame generation ────────────────────────────────────────────────

async function generateSpinFrameWithGemini(
  apiKey: string,
  model: string,
  referenceImageBase64: string,
  referenceImageMime: string,
  angle: number,
): Promise<Buffer | null> {
  const prompt = `Generate a high-quality product photo of the same item rotated horizontally by exactly ${angle} degrees relative to the camera. Maintain completely locked geometry, original colors, texture, shape, proportions, and fine details. Show the product on a clean studio white background under uniform soft lighting. Do not change any features of the product.`;
  return callGeminiImageAPI(apiKey, model, prompt, referenceImageBase64, referenceImageMime);
}

// ─── Grid assembly using sharp ────────────────────────────────────────────────

async function assembleGrid(
  colors: string[],
  generatedImages: Map<string, string>,
  fallbackImagePath: string,
  originalDimensions: { width: number; height: number },
  cols: number,
  outputPath: string,
): Promise<void> {
  const { width: imgWidth, height: imgHeight } = originalDimensions;
  const rows = Math.ceil(colors.length / cols);
  const gridWidth = imgWidth * cols;
  const gridHeight = imgHeight * rows;

  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];
    const imgPath = generatedImages.get(color) || fallbackImagePath;
    const col = i % cols;
    const row = Math.floor(i / cols);

    const normalizedBuf = await sharp(imgPath)
      .resize(imgWidth, imgHeight, { fit: 'fill', kernel: 'lanczos3' })
      .png()
      .toBuffer();

    composites.push({ input: normalizedBuf, left: col * imgWidth, top: row * imgHeight });
  }

  await sharp({
    create: { width: gridWidth, height: gridHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toFile(outputPath);
}

// ─── Main POST handler ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    // ── Validate request body with Zod ────────────────────────────────────────
    let parsedBody: z.infer<typeof GenerateDirectRequestSchema>;
    try {
      const rawBody = await req.json();
      const parseResult = GenerateDirectRequestSchema.safeParse(rawBody);
      if (!parseResult.success) {
        return NextResponse.json(
          { error: 'Invalid request', details: parseResult.error.flatten().fieldErrors },
          { status: 400 },
        );
      }
      parsedBody = parseResult.data;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { jobId, prompt, settings } = parsedBody;

    // Verify job ownership
    const job = await prisma.job.findFirst({
      where: { id: jobId, userId: Number(userId) },
      include: { assets: { where: { type: 'original' } } },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    // Get Gemini API key
    const geminiProvider = await prisma.aiProvider.findFirst({
      where: { name: { contains: 'gemini', mode: 'insensitive' } },
    });
    if (!geminiProvider?.apiKey) {
      return NextResponse.json(
        { error: 'Gemini API key not configured. Please add it in Profile → Settings.' },
        { status: 400 },
      );
    }

    // Decrypt API key if encrypted
    const geminiApiKey = decryptApiKey(geminiProvider.apiKey);

    // Load reference image
    const originalAsset = job.assets[0];
    if (!originalAsset) {
      return NextResponse.json({ error: 'No reference image found for this job. Please upload an image first.' }, { status: 400 });
    }

    // ── SECURITY: validate ref image path is within storage ──────────────────
    assertWithinStorage(originalAsset.path);

    const { readFile } = await import('fs/promises');
    let refImageBuffer: Buffer;
    try {
      refImageBuffer = await readFile(originalAsset.path);
    } catch {
      return NextResponse.json({ error: 'Could not read reference image from storage' }, { status: 500 });
    }

    const refImageBase64 = refImageBuffer.toString('base64');
    const refImageMime = originalAsset.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

    // Config
    const rawImageModel = settings?.imageModel || 'gemini-3-pro-image';
    const imageModel = getOptimalImageModel(rawImageModel);
    const colors: string[] = (settings?.colors && settings.colors.length > 0)
      ? settings.colors
      : ['White', 'Black', 'Blue', 'Red'];
    const videoPromptText = settings?.videoPrompt || 'Cinematic showcase of the product under dynamic studio lighting';
    const gridCols = settings?.cols || 2;

    // Update job status
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
        prompt: {
          upsert: {
            create: { name: 'generation-prompt', content: prompt },
            update: { content: prompt },
          },
        },
        generation: {
          upsert: {
            create: { metadata: settings || {} },
            update: settings ? { metadata: settings as any } : {},
          },
        },
      },
    });

    log.info({ jobId: job.id, colors: colors.length, imageModel }, 'Generation started');

    // Setup storage
    const jobAssetDir = path.join(STORAGE_PATH, 'assets', String(job.id));
    await mkdir(jobAssetDir, { recursive: true });
    // ── SECURITY: Validate output directory ──────────────────────────────────
    assertWithinStorage(jobAssetDir);

    // ── 1. Generate color variants ────────────────────────────────────────────
    const results: { color: string; assetId?: number; error?: string; filePath?: string }[] = [];

    const generateColor = async (colorName: string) => {
      console.log(`[Generate-Direct] Generating color: ${colorName}`);
      const startTime = Date.now();
      try {
        const imgBuffer = await generateColorVariantWithGemini(
          geminiApiKey, imageModel, prompt, refImageBase64, refImageMime, colorName,
        );
        const latencyMs = Date.now() - startTime;

        if (!imgBuffer) {
          console.warn(`[Generate-Direct] ⚠️ No image returned by Gemini for color ${colorName} after ${latencyMs}ms using model "${imageModel}"`);
          results.push({ color: colorName, error: 'No image returned by Gemini' });
          return;
        }

        // Cost estimation for this individual image based on selected model
        let costPerImage = 0.0004;
        if (imageModel.includes('imagen')) {
          costPerImage = 0.0300;
        } else if (imageModel.includes('pro')) {
          costPerImage = 0.0015;
        }

        console.log(`[Generate-Direct] ✅ Generated color ${colorName} in ${latencyMs}ms using model "${imageModel}". Image size: ${imgBuffer.length} bytes. Estimated Image Cost: $${costPerImage.toFixed(4)}`);

        const safeColor = colorName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
        const filename = `raw_${safeColor}.png`;
        const filePath = path.join(jobAssetDir, filename);
        assertWithinStorage(filePath);

        await writeFile(filePath, imgBuffer);

        // ── WebP compression pass (P3.6) ──────────────────────────────────────
        // Save a compressed WebP alongside the PNG (~60-70% smaller).
        // Used for web delivery; PNG is kept for downstream processing (grid, crops).
        let webpAssetId: number | undefined;
        try {
          const webpFilename = `raw_${safeColor}.webp`;
          const webpPath = path.join(jobAssetDir, webpFilename);
          assertWithinStorage(webpPath);
          const webpStartTime = Date.now();
          const webpBuffer = await sharp(imgBuffer).webp({ quality: 85, effort: 4 }).toBuffer();
          const webpLatencyMs = Date.now() - webpStartTime;
          await writeFile(webpPath, webpBuffer);
          const webpAsset = await prisma.asset.create({
            data: { type: 'variant-webp', path: webpPath, status: 'done', jobId: job.id },
          });
          webpAssetId = webpAsset.id;
          console.log(`[WebP] Compressed color ${colorName} in ${webpLatencyMs}ms. PNG size: ${imgBuffer.length} bytes -> WebP size: ${webpBuffer.length} bytes (${((webpBuffer.length / imgBuffer.length) * 100).toFixed(1)}% of original)`);
        } catch (webpErr: any) {
          console.warn(`[WebP] Compression failed for ${colorName}:`, webpErr.message);
        }

        const existing = await prisma.asset.findFirst({
          where: { jobId: job.id, type: 'variant', path: filePath },
        });
        let asset;
        if (existing) {
          asset = await prisma.asset.update({ where: { id: existing.id }, data: { status: 'done', path: filePath } });
        } else {
          asset = await prisma.asset.create({ data: { type: 'variant', path: filePath, status: 'done', jobId: job.id } });
        }

        results.push({ color: colorName, assetId: asset.id, filePath });

      } catch (err: any) {
        console.error(`[Generate-Direct] Error for color ${colorName}:`, err.message);
        results.push({ color: colorName, error: err.message });
      }
    };

    // Process in batches of 3 (rate-limit friendly)
    const BATCH = 3;
    for (let i = 0; i < colors.length; i += BATCH) {
      const batch = colors.slice(i, i + BATCH);
      await Promise.all(batch.map(generateColor));
    }

    const failedColors = results.filter((r) => r.error);
    const successResults = results.filter((r) => r.assetId && r.filePath);
    const successCount = successResults.length;
    const finalStatus = failedColors.length === colors.length ? 'FAILED' : 'COMPLETED';

    if (successCount > 0) {
      const safePrefix = job.name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');

      // Get original image dimensions for grid
      const originalMeta = await sharp(originalAsset.path).metadata();
      const imgDimensions = { width: originalMeta.width || 800, height: originalMeta.height || 600 };

      // ── 2. Grid generation ───────────────────────────────────────────────────
      const gridPath = path.join(jobAssetDir, `grid_${safePrefix}_production_grid.png`);
      assertWithinStorage(gridPath);

      try {
        console.log(`\n[System] Assembling ${gridCols}x${Math.ceil(colors.length / gridCols)} grid...`);
        const generatedImages = new Map<string, string>();
        for (const res of successResults) {
          generatedImages.set(res.color, res.filePath!);
        }

        await assembleGrid(colors, generatedImages, originalAsset.path, imgDimensions, gridCols, gridPath);

        await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'grid' } });
        await prisma.asset.create({ data: { jobId: job.id, type: 'grid', path: gridPath, status: 'done' } });
        console.log(`✅ Grid assembled: ${gridPath}`);
      } catch (err: any) {
        console.error('Grid assembly failed:', err.message);
      }

      // ── 3. Video generation via Gemini Veo (async — enqueued to BullMQ) ────────
      // Video generation takes up to 10 minutes. We enqueue it as a background job
      // instead of blocking this HTTP request. The frontend can poll job status or
      // use SSE to receive the completion event.
      if (settings?.videoEnabled === true) {
        const rawVideoModel = settings?.videoModel || 'veo-3.1-generate-preview';
        const videoModel = getOptimalVideoModel(rawVideoModel);
        const videoPath = path.join(jobAssetDir, `${safePrefix}_showcase.mp4`);
        assertWithinStorage(videoPath);

        try {
          // Create a pending 'video' asset so the UI knows video is in progress
          await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'video' } });
          await prisma.asset.create({
            data: { jobId: job.id, type: 'video', path: videoPath, status: 'pending' },
          });

          await veoVideoQueue.add('generate-video', {
            jobId: job.id,
            geminiApiKey,
            imageModel,
            videoModel,
            videoPrompt: videoPromptText,
            refImagePath: originalAsset.path,
            refImageMime,
            videoPath,
            fallbackSafePrefix: safePrefix,
            jobAssetDir,
          }, {
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
          });
          console.log(`[Video] Enqueued Veo video job for job ${job.id}`);
        } catch (err: any) {
          console.error('[Video] Failed to enqueue Veo job:', err.message);
        }
      }

      // ── 4. 360 Spin generation ───────────────────────────────────────────────
      if (settings?.spinEnabled === true) {
        console.log('Starting 360 spin frame generation...');
        const angles = Array.from({ length: 36 }, (_, i) => i * 10);
        const spinResults: { angle: number; filePath: string; buffer: Buffer }[] = [];

        const generateAngleFrame = async (angle: number) => {
          try {
            const frameBuffer = await generateSpinFrameWithGemini(
              geminiApiKey, imageModel, refImageBase64, refImageMime, angle,
            );
            if (frameBuffer) {
              const filename = `${safePrefix}_360_${String(angle).padStart(3, '0')}.png`;
              const filePath = path.join(jobAssetDir, filename);
              assertWithinStorage(filePath);
              await writeFile(filePath, frameBuffer);
              spinResults.push({ angle, filePath, buffer: frameBuffer });
            }
          } catch (err: any) {
            console.error(`Spin frame ${angle}° failed:`, err.message);
          }
        };

        const SPIN_BATCH = 4;
        for (let i = 0; i < angles.length; i += SPIN_BATCH) {
          await Promise.all(angles.slice(i, i + SPIN_BATCH).map(generateAngleFrame));
        }

        if (spinResults.length > 0) {
          spinResults.sort((a, b) => a.angle - b.angle);

          // Build contact sheet from spin frames
          const spinContactPath = path.join(jobAssetDir, `${safePrefix}_turntable.png`);
          assertWithinStorage(spinContactPath);
          try {
            const maxFrames = Math.min(spinResults.length, 8);
            const step = Math.floor(spinResults.length / maxFrames);
            const selected = Array.from({ length: maxFrames }, (_, i) => spinResults[i * step].buffer);
            const meta = await sharp(selected[0]).metadata();
            const fW = meta.width || 400;
            const fH = meta.height || 400;
            const THUMB_W = 300;
            const THUMB_H = Math.round((THUMB_W / fW) * fH);

            const resized = await Promise.all(
              selected.map(f => sharp(f).resize(THUMB_W, THUMB_H, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer())
            );

            const contactComposites: sharp.OverlayOptions[] = resized.map((buf, i) => ({ input: buf, left: i * THUMB_W, top: 0 }));

            await sharp({ create: { width: THUMB_W * resized.length, height: THUMB_H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
              .composite(contactComposites)
              .png()
              .toFile(spinContactPath);

            await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'spin' } });
            await prisma.asset.create({ data: { jobId: job.id, type: 'spin', path: spinContactPath, status: 'done' } });
          } catch (err: any) {
            console.warn('Contact sheet failed, saving first frame:', err.message);
            const firstFrame = spinResults[0];
            await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'spin' } });
            await prisma.asset.create({ data: { jobId: job.id, type: 'spin', path: firstFrame.filePath, status: 'done' } });
          }

          await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'spin-frame' } });
          for (const frame of spinResults) {
            await prisma.asset.create({ data: { jobId: job.id, type: 'spin-frame', path: frame.filePath, status: 'done' } });
          }
        }
      }

      // ── 5. Social Crops via sharp (no @imgly dependency) ─────────────────────
      if (settings?.cropsEnabled !== false) {
        const processedDir = path.join(jobAssetDir, 'processed');
        assertWithinStorage(processedDir);
        await mkdir(processedDir, { recursive: true });

        for (const result of successResults) {
          const inputPath = result.filePath!;
          const colorSlug = result.color.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();

          try {
            const metadata = await sharp(inputPath).metadata();
            const w = metadata.width || 800;
            const h = metadata.height || 600;
            const aspect = w / h;

            // 1. Instagram 1:1
            const sqSize = Math.min(w, h);
            const instaPath = path.join(processedDir, `${safePrefix}_${colorSlug}_instagram.png`);
            assertWithinStorage(instaPath);
            await sharp(inputPath)
              .extract({ left: Math.floor((w - sqSize) / 2), top: Math.floor((h - sqSize) / 2), width: sqSize, height: sqSize })
              .png()
              .toFile(instaPath);
            await prisma.asset.create({ data: { jobId: job.id, type: 'crop', path: instaPath, status: 'approved' } });

            // 2. Banner 16:9
            const banner169 = 16 / 9;
            let bW = w, bH = h, bLeft = 0, bTop = 0;
            if (aspect > banner169) { bW = Math.floor(h * banner169); bLeft = Math.floor((w - bW) / 2); }
            else { bH = Math.floor(w / banner169); bTop = Math.floor((h - bH) / 2); }
            const bannerPath = path.join(processedDir, `${safePrefix}_${colorSlug}_banner.png`);
            assertWithinStorage(bannerPath);
            await sharp(inputPath).extract({ left: bLeft, top: bTop, width: bW, height: bH }).png().toFile(bannerPath);
            await prisma.asset.create({ data: { jobId: job.id, type: 'crop', path: bannerPath, status: 'approved' } });

            // 3. Story 9:16
            const story916 = 9 / 16;
            let sW = w, sH = h, sLeft = 0, sTop = 0;
            if (aspect > story916) { sW = Math.floor(h * story916); sLeft = Math.floor((w - sW) / 2); }
            else { sH = Math.floor(w / story916); sTop = Math.floor((h - sH) / 2); }
            const storyPath = path.join(processedDir, `${safePrefix}_${colorSlug}_story.png`);
            assertWithinStorage(storyPath);
            await sharp(inputPath).extract({ left: sLeft, top: sTop, width: sW, height: sH }).png().toFile(storyPath);
            await prisma.asset.create({ data: { jobId: job.id, type: 'crop', path: storyPath, status: 'approved' } });
          } catch (err: any) {
            console.error(`Crops failed for ${colorSlug}:`, err.message);
          }
        }
      }
    }

    // ── Finalize job ──────────────────────────────────────────────────────────
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: finalStatus as any,
        completedAt: new Date(),
        progress: colors.length > 0 ? successCount / colors.length : 0,
        errorMessage: failedColors.length > 0 ? `${failedColors.length} color(s) failed` : null,
        statusHistory: results.map((r) => ({
          color: r.color,
          status: r.error ? 'COLOR_FAILED' : 'done',
          message: r.error || 'Generated successfully',
        })) as any,
      },
    });

    // Log cost estimate (P5.3)
    logGenerationCost(job.id, successCount, settings?.videoEnabled === true, failedColors.length, imageModel, settings?.videoModel || 'veo-3.1-generate-preview');
    log.info({ jobId: job.id, generated: successCount, failed: failedColors.length, status: finalStatus }, 'Generation complete');

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: finalStatus,
      generated: successCount,
      total: colors.length,
      failed: failedColors.map((r) => ({ color: r.color, error: r.error })),
    });
  } catch (err: any) {
    logErrorEvent('generate-direct', err);
    if (err.message === 'Access denied: path is outside storage boundary') {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// decryptApiKey is imported from '../../../../lib/crypto'
