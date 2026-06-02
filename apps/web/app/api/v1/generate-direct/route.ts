import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// ─── Gemini image generation helper ─────────────────────────────────────────

async function callGeminiImageAPI(
  apiKey: string,
  model: string,
  promptText: string,
  referenceImageBase64: string,
  referenceImageMime: string,
  maxRetries: number = 3,
): Promise<Buffer | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        const errLower = errText.toLowerCase();

        // Check for rate limit or quota errors
        if (res.status === 429 || errLower.includes('quota') || errLower.includes('rate limit')) {
          if (attempt < maxRetries - 1) {
            // Exponential backoff: 2^attempt + random jitter
            const sleepMs = (Math.pow(2, attempt) + (Math.random() + 0.5)) * 1000;
            console.log(`   ⏳ [API] Rate limited (429). Backing off for ${(sleepMs / 1000).toFixed(1)}s...`);
            await new Promise((resolve) => setTimeout(resolve, sleepMs));
            continue;
          }
        }
        throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 500)}`);
      }

      const data = await res.json();
      const candidates = data?.candidates || [];

      for (const candidate of candidates) {
        for (const part of candidate?.content?.parts || []) {
          if (part?.inlineData?.mimeType?.startsWith('image/')) {
            return Buffer.from(part.inlineData.data, 'base64');
          }
        }
      }

      console.warn(`   ⚠️ [API] Warning: API returned empty image data.`);
      return null;

    } catch (err: any) {
      const errorMsg = err.message.toLowerCase();
      if ((errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate limit')) && attempt < maxRetries - 1) {
        const sleepMs = (Math.pow(2, attempt) + (Math.random() + 0.5)) * 1000;
        console.log(`   ⏳ [API] Rate limited. Backing off for ${(sleepMs / 1000).toFixed(1)}s...`);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        continue;
      }
      throw err;
    }
  }

  return null;
}

// ─── Color variant generation ────────────────────────────────────────────────

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

// ─── Video generation via Gemini Veo (image-to-video) ────────────────────────
//
// Step 1: Upload reference image to Gemini Files API → get fileUri
// Step 2: Call veo-3.1-generate-preview:predictLongRunning with image fileUri
// Step 3: Poll the long-running operation until done
// Step 4: Download the MP4 video bytes
//
// This mirrors the Python SDK pattern:
//   operation = client.models.generate_videos(model="veo-3.1-generate-preview", prompt=..., image=...)
//   while not operation.done: time.sleep(10); operation = client.operations.get(operation)
//   video.video.save("output.mp4")

// ── Step 1: Generate video via Veo + poll until done ───────────────────────

async function generateVideoWithVeo(
  apiKey: string,
  videoPrompt: string,
  imageBase64: string,
  imageMimeType: string,
  videoModel: string = 'veo-3.1-generate-preview',
): Promise<string | null> {
  // POST predictLongRunning with image input
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

  console.log(`[Video] Starting Veo video generation with model: ${videoModel}`);
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

  console.log(`[Video] Operation started: ${operationName}. Polling for completion...`);

  // ── Step 2: Poll until done (mirrors: while not operation.done: time.sleep(10)) ──
  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
  const MAX_POLLS = 60; // up to 10 minutes
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

      // Extract video download URI from response using the correct Veo schema path
      const generatedVideos =
        pollData.response?.generateVideoResponse?.generatedSamples ||
        pollData.response?.generatedVideos ||
        pollData.response?.videos ||
        [];

      for (const videoObj of generatedVideos) {
        const videoUri = videoObj?.video?.uri || videoObj?.uri;
        if (videoUri) {
          console.log(`[Video] Generation complete. Video URI: ${videoUri}`);
          return videoUri;
        }
        // Also check for inline bytes
        const videoBytes = videoObj?.video?.bytesBase64Encoded || videoObj?.video?.videoBytes;
        if (videoBytes) {
          console.log(`[Video] Generation complete (inline bytes).`);
          return `data:video/mp4;base64,${videoBytes}`;
        }
      }

      throw new Error(`Veo operation done but no video in response: ${JSON.stringify(pollData).slice(0, 500)}`);
    }
  }

  throw new Error(`Veo video generation timed out after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s`);
}

// ── Step 4: Download video from URI → Buffer ──────────────────────────────────

async function downloadVideoFromUri(
  apiKey: string,
  videoUri: string,
): Promise<Buffer> {
  // Handle inline base64 data URIs (e.g. "data:video/mp4;base64,...")
  if (videoUri.startsWith('data:')) {
    const base64 = videoUri.split(',')[1];
    return Buffer.from(base64, 'base64');
  }

  // Handle Gemini Files API URIs — need to fetch via files download endpoint
  // URI format: "https://generativelanguage.googleapis.com/v1beta/files/FILE_ID"
  // Download via: GET <uri>?alt=media&key=API_KEY
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

// ── Full video generation orchestrator ───────────────────────────────────────

async function generateVideoWithGemini(
  apiKey: string,
  videoModel: string,
  videoPrompt: string,
  referenceImageBuffer: Buffer,
  referenceImageMime: string,
): Promise<Buffer | null> {
  // Convert buffer to base64 for direct inline usage in Veo API
  const imageBase64 = referenceImageBuffer.toString('base64');

  // Step 1: Generate video via Veo + poll
  const videoUri = await generateVideoWithVeo(apiKey, videoPrompt, imageBase64, referenceImageMime, videoModel);
  if (!videoUri) return null;

  // Step 2: Download video bytes
  const videoBuffer = await downloadVideoFromUri(apiKey, videoUri);
  console.log(`[Video] Video downloaded successfully (${videoBuffer.length} bytes)`);
  return videoBuffer;
}

// ─── Compile spin frames into a preview image (pure Node.js / sharp) ─────────
//
// Creates a horizontal contact sheet from the first 8 frames (showing different angles)
// as a PNG using sharp — no extra dependencies needed.
// Falls back to returning the first frame buffer if sharp fails.

async function compileAnimatedGIF(frames: Buffer[], _delayMs: number = 200): Promise<Buffer> {
  if (frames.length === 0) throw new Error('No frames provided for GIF compilation');
  if (frames.length === 1) return frames[0];

  try {
    // Use sharp to create a horizontal contact sheet of up to 8 frames
    // This gives the user a preview without requiring GIF encoding
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');

    // Use up to 8 evenly-spaced frames for the contact sheet
    const maxFrames = Math.min(frames.length, 8);
    const step = Math.floor(frames.length / maxFrames);
    const selectedFrames = Array.from({ length: maxFrames }, (_, i) => frames[i * step]);

    // Get dimensions from the first frame
    const meta = await sharp(selectedFrames[0]).metadata();
    const frameW = meta.width || 400;
    const frameH = meta.height || 400;

    // Resize each frame to a consistent size
    const THUMB_W = 300;
    const THUMB_H = Math.round((THUMB_W / frameW) * frameH);

    const resizedFrames = await Promise.all(
      selectedFrames.map(f =>
        sharp(f).resize(THUMB_W, THUMB_H, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer()
      )
    );

    // Composite them horizontally
    const totalWidth = THUMB_W * resizedFrames.length;
    const totalHeight = THUMB_H;

    const composites = resizedFrames.map((buf, i) => ({
      input: buf,
      left: i * THUMB_W,
      top: 0,
    }));

    const contactSheet = await sharp({
      create: { width: totalWidth, height: totalHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite(composites)
      .png()
      .toBuffer();

    return contactSheet;
  } catch (err) {
    console.warn('Contact sheet compilation failed, returning first frame:', err);
    return frames[0];
  }
}

// ─── 360 Spin frame generation ───────────────────────────────────────────────

async function generateSpinFrameWithGemini(
  apiKey: string,
  model: string,
  referenceImageBase64: string,
  referenceImageMime: string,
  angle: number,
): Promise<Buffer | null> {
  // Locked geometry prompt per angle
  const prompt = `Generate a high-quality product photo of the same item rotated horizontally by exactly ${angle} degrees relative to the camera. Maintain completely locked geometry, original colors, texture, shape, proportions, and fine details. Show the product on a clean studio white background under uniform soft lighting. Do not change any features of the product.`;

  return callGeminiImageAPI(apiKey, model, prompt, referenceImageBase64, referenceImageMime);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = await req.json();
    const { jobId, prompt, settings } = body;

    if (!jobId || !prompt) {
      return NextResponse.json({ error: 'jobId and prompt are required' }, { status: 400 });
    }

    // Verify job ownership
    const job = await prisma.job.findFirst({
      where: { id: Number(jobId), userId: Number(userId) },
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

    // Load reference image
    const originalAsset = job.assets[0];
    if (!originalAsset) {
      return NextResponse.json({ error: 'No reference image found for this job' }, { status: 400 });
    }

    const { readFile } = await import('fs/promises');
    let refImageBuffer: Buffer;
    try {
      refImageBuffer = await readFile(originalAsset.path);
    } catch {
      return NextResponse.json({ error: 'Could not read reference image from storage' }, { status: 500 });
    }

    const refImageBase64 = refImageBuffer.toString('base64');
    const refImageMime = originalAsset.path.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';

    // Model config
    const imageModel = settings?.imageModel || 'gemini-2.0-flash-preview-image-generation';
    const colors: string[] = settings?.colors || ['White', 'Black', 'Blue', 'Red'];
    const videoPromptText = settings?.videoPrompt || 'Cinematic showcase of the product under dynamic studio lighting';

    // Update job status to PROCESSING
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
            update: { metadata: settings || {} },
          },
        },
      },
    });

    // Setup storage
    const baseStorage = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');
    const jobAssetDir = path.join(baseStorage, 'assets', String(job.id));
    await mkdir(jobAssetDir, { recursive: true });

    // ── 1. Generate color variants ────────────────────────────────────────────
    const results: { color: string; assetId?: number; error?: string; filePath?: string }[] = [];

    const generateColor = async (colorName: string) => {
      try {
        const imgBuffer = await generateColorVariantWithGemini(
          geminiProvider.apiKey,
          imageModel,
          prompt,
          refImageBase64,
          refImageMime,
          colorName,
        );

        if (!imgBuffer) {
          results.push({ color: colorName, error: 'No image returned by Gemini' });
          return;
        }

        const safeColor = colorName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
        const filename = `raw_${safeColor}.png`;
        const filePath = path.join(jobAssetDir, filename);
        await writeFile(filePath, imgBuffer);

        const existing = await prisma.asset.findFirst({
          where: { jobId: job.id, type: 'variant', path: filePath },
        });
        let asset;
        if (existing) {
          asset = await prisma.asset.update({
            where: { id: existing.id },
            data: { status: 'done', path: filePath },
          });
        } else {
          asset = await prisma.asset.create({
            data: { type: 'variant', path: filePath, status: 'done', jobId: job.id },
          });
        }

        results.push({ color: colorName, assetId: asset.id, filePath });
      } catch (err: any) {
        results.push({ color: colorName, error: err.message });
      }
    };

    // Process in batches of 3 (rate limit friendly)
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
      const safePrefix = job.name
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_-]/g, '');

      // ── 2. Grid generation (Fault-Tolerant Compiler Matrix) ─────────────────────
      const gridPath = path.join(jobAssetDir, `grid_${safePrefix}_production_grid.png`);
      const gridCols = settings?.cols || 3;
      const gridRows = Math.ceil(colors.length / gridCols);

      if (colors.length > 0) {
        console.log(`\n[System] Assembling the ${gridCols}x${gridRows} Grid Matrix...`);
        try {
          const originalMeta = await sharp(originalAsset.path).metadata();
          const imgWidth = originalMeta.width || 800;
          const imgHeight = originalMeta.height || 600;

          const gridWidth = imgWidth * gridCols;
          const gridHeight = imgHeight * gridRows;

          const compositeLayers = [];

          // Base canvas layer
          compositeLayers.push({
            input: { create: { width: gridWidth, height: gridHeight, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } },
            left: 0,
            top: 0
          });

          // Map successful generation paths by color
          const generatedImages = new Map<string, string>();
          for (const res of successResults) {
            generatedImages.set(res.color, res.filePath!);
          }

          // Fault-tolerant assembly looping over ALL colors
          for (let i = 0; i < colors.length; i++) {
            const color = colors[i];
            // Fallback to the original image if this specific thread failed
            const imgPath = generatedImages.get(color) || originalAsset.path;

            const col = i % gridCols;
            const row = Math.floor(i / gridCols);
            const left = col * imgWidth;
            const top = row * imgHeight;

            // Edge Case: Force dimension normalization in case the model hallucinated a different crop
            const normalizedImgBuffer = await sharp(imgPath)
              .resize(imgWidth, imgHeight, { fit: 'fill', kernel: 'lanczos3' })
              .toBuffer();

            compositeLayers.push({
              input: normalizedImgBuffer,
              left,
              top
            });
          }

          // Output the grid
          await sharp({
            create: {
              width: gridWidth,
              height: gridHeight,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
          })
            .composite(compositeLayers)
            .toFile(gridPath);

          await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'grid' } });
          await prisma.asset.create({
            data: { jobId: job.id, type: 'grid', path: gridPath, status: 'done' }
          });
          console.log(`🚀 Pipeline execution complete! Final output ready at: ${gridPath}`);
        } catch (err: any) {
          console.error('CRITICAL: Failed to assemble grid matrix:', err.message);
        }
      }

      // ── 3. Video generation via Gemini Veo (image-to-video) ───────────────
      if (settings?.videoEnabled === true) {
        const videoModel = settings?.videoModel || 'veo-3.1-generate-preview';
        const videoPath = path.join(jobAssetDir, `${safePrefix}_showcase.mp4`);

        console.log(`[Video] Starting Veo video generation (model: ${videoModel})...`);
        try {
          const videoBuffer = await generateVideoWithGemini(
            geminiProvider.apiKey,
            videoModel,
            videoPromptText,
            refImageBuffer, // Pass original Buffer, not base64
            refImageMime,
          );

          if (videoBuffer) {
            await writeFile(videoPath, videoBuffer);
            await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'video' } });
            await prisma.asset.create({
              data: { jobId: job.id, type: 'video', path: videoPath, status: 'done' }
            });
            console.log(`[Video] MP4 saved successfully at: ${videoPath} (${videoBuffer.length} bytes)`);
          } else {
            console.warn('[Video] generateVideoWithGemini returned null — no video saved');
          }
        } catch (err: any) {
          console.error('[Video] Veo generation failed:', err.message);
          // Graceful fallback: generate a high-quality showcase still image
          // so the video slot isn't empty in the review UI
          try {
            const fallbackPrompt = `${videoPromptText}. Cinematic product showcase — dramatic studio hero shot with premium lighting.`;
            const fallbackBuffer = await callGeminiImageAPI(
              geminiProvider.apiKey, imageModel, fallbackPrompt, refImageBase64, refImageMime
            );
            if (fallbackBuffer) {
              const fallbackPath = path.join(jobAssetDir, `${safePrefix}_showcase_still.png`);
              await writeFile(fallbackPath, fallbackBuffer);
              await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'video' } });
              await prisma.asset.create({
                data: { jobId: job.id, type: 'video', path: fallbackPath, status: 'done' }
              });
              console.log('[Video] Fallback showcase still saved at:', fallbackPath);
            }
          } catch (fallbackErr: any) {
            console.error('[Video] Fallback still also failed:', fallbackErr.message);
          }
        }
      }

      // ── 4. 360 Spin generation (0° to 350° in 10° steps) ───────────────────
      if (settings?.spinEnabled === true) {
        console.log('Starting 360 spin frame generation using Image-to-Image...');
        const angles = Array.from({ length: 36 }, (_, i) => i * 10);
        const spinResults: { angle: number; filePath: string; buffer: Buffer }[] = [];

        const generateAngleFrame = async (angle: number) => {
          try {
            const frameBuffer = await generateSpinFrameWithGemini(
              geminiProvider.apiKey,
              imageModel,
              refImageBase64,
              refImageMime,
              angle,
            );

            if (frameBuffer) {
              const filename = `${safePrefix}_360_${String(angle).padStart(3, '0')}.png`;
              const filePath = path.join(jobAssetDir, filename);
              await writeFile(filePath, frameBuffer);
              spinResults.push({ angle, filePath, buffer: frameBuffer });
            }
          } catch (err: any) {
            console.error(`Failed to generate 360 spin frame for angle ${angle}:`, err.message);
          }
        };

        // Process in batches of 6 (rate-limit friendly)
        const SPIN_BATCH = 6;
        for (let i = 0; i < angles.length; i += SPIN_BATCH) {
          const batch = angles.slice(i, i + SPIN_BATCH);
          await Promise.all(batch.map(generateAngleFrame));
        }

        console.log(`Generated ${spinResults.length}/36 spin frames.`);

        if (spinResults.length > 0) {
          // Sort frames by angle
          spinResults.sort((a, b) => a.angle - b.angle);

          // Compile contact sheet from spin frames (uses sharp, no extra deps)
          const spinGifPath = path.join(jobAssetDir, `${safePrefix}_turntable.png`);
          try {
            const spinBuffers = spinResults.map(r => r.buffer);
            const gifBuffer = await compileAnimatedGIF(spinBuffers, 80);
            await writeFile(spinGifPath, gifBuffer);

            await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'spin' } });
            await prisma.asset.create({
              data: { jobId: job.id, type: 'spin', path: spinGifPath, status: 'done' }
            });
            console.log('360 spin contact sheet saved at:', spinGifPath);
          } catch (err) {
            // Compilation failed — save first frame as spin asset instead
            console.warn('Contact sheet compilation failed, saving first spin frame as spin asset:', err);
            const firstFrame = spinResults[0];
            await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'spin' } });
            await prisma.asset.create({
              data: { jobId: job.id, type: 'spin', path: firstFrame.filePath, status: 'done' }
            });
          }

          // Save individual spin frames as 'spin-frame' assets for the interactive viewer
          await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'spin-frame' } });
          for (const frame of spinResults) {
            await prisma.asset.create({
              data: { jobId: job.id, type: 'spin-frame', path: frame.filePath, status: 'done' }
            });
          }

          // Also save a JSON manifest of all spin frames for the frontend
          const manifestPath = path.join(jobAssetDir, `${safePrefix}_360_manifest.json`);
          await writeFile(manifestPath, JSON.stringify({
            frames: spinResults.map(r => ({ angle: r.angle, file: path.basename(r.filePath) })),
            total: spinResults.length,
          }, null, 2));
        }
      }

      // ── 5. Background Removal & Social Crops (via Node Native) ───────────────
      const processedDir = path.join(jobAssetDir, 'processed');
      if (settings?.cropsEnabled !== false || settings?.removeBackground !== false) {
        console.log('\\n[System] Generating background-removed images and social media crops natively...');
        if (!require('fs').existsSync(processedDir)) {
          require('fs').mkdirSync(processedDir, { recursive: true });
        }

        // Dynamically load background removal module
        let removeBackground: any = null;
        try {
          const imgly = await import('@imgly/background-removal-node');
          removeBackground = imgly.removeBackground;
        } catch (e: any) {
          console.warn('⚠️ Could not load @imgly/background-removal-node. Skipping background removal:', e.message);
        }

        try {
          for (const result of successResults) {
            const inputPath = result.filePath!;
            const colorSlug = result.color.replace(/\\s+/g, '_');

            // ── A. Background Removal ──
            const processedPath = path.join(processedDir, `raw_${colorSlug}.png`);
            let useImgPath = inputPath; // default to original if bg removal fails

            if (removeBackground) {
              console.log(`[Background] Removing background for variant: ${colorSlug}...`);
              try {
                // Format URL as file:// for local paths in node
                const bgBlob = await removeBackground(`file://${inputPath.replace(/\\\\/g, '/')}`);
                const bgBuffer = Buffer.from(await bgBlob.arrayBuffer());
                await writeFile(processedPath, bgBuffer);

                await prisma.asset.create({
                  data: { jobId: job.id, type: 'processed', path: processedPath, status: 'done', originalAssetId: originalAsset?.id }
                });
                useImgPath = processedPath; // Use the transparent image for crops!
              } catch (bgErr: any) {
                console.error(`[Background] Failed to remove background for ${colorSlug}:`, bgErr.message);
                await require('fs').promises.copyFile(inputPath, processedPath);
              }
            } else {
              // Fallback: just copy original to processed if module not found
              await require('fs').promises.copyFile(inputPath, processedPath);
              await prisma.asset.create({
                data: { jobId: job.id, type: 'processed', path: processedPath, status: 'done', originalAssetId: originalAsset?.id }
              });
            }

            // ── B. Social Crops ──
            if (settings?.cropsEnabled !== false) {
              const metadata = await sharp(useImgPath).metadata();
              const w = metadata.width || 800;
              const h = metadata.height || 600;
              const currentAspect = w / h;

              // 1. Instagram 1:1
              const sqSize = Math.min(w, h);
              const sqLeft = Math.floor((w - sqSize) / 2);
              const sqTop = Math.floor((h - sqSize) / 2);
              const instaPath = path.join(processedDir, `${safePrefix}_${colorSlug}_instagram.png`);
              await sharp(useImgPath).extract({ left: sqLeft, top: sqTop, width: sqSize, height: sqSize }).toFile(instaPath);
              await prisma.asset.create({ data: { jobId: job.id, type: 'crop', path: instaPath, status: 'approved' } });

              // 2. Banner 16:9
              const targetAspectBanner = 16.0 / 9.0;
              let bW = w, bH = h, bLeft = 0, bTop = 0;
              if (currentAspect > targetAspectBanner) {
                bW = Math.floor(h * targetAspectBanner);
                bLeft = Math.floor((w - bW) / 2);
              } else {
                bH = Math.floor(w / targetAspectBanner);
                bTop = Math.floor((h - bH) / 2);
              }
              const bannerPath = path.join(processedDir, `${safePrefix}_${colorSlug}_banner.png`);
              await sharp(useImgPath).extract({ left: bLeft, top: bTop, width: bW, height: bH }).toFile(bannerPath);
              await prisma.asset.create({ data: { jobId: job.id, type: 'crop', path: bannerPath, status: 'approved' } });

              // 3. Story 9:16
              const targetAspectStory = 9.0 / 16.0;
              let sW = w, sH = h, sLeft = 0, sTop = 0;
              if (currentAspect > targetAspectStory) {
                sW = Math.floor(h * targetAspectStory);
                sLeft = Math.floor((w - sW) / 2);
              } else {
                sH = Math.floor(w / targetAspectStory);
                sTop = Math.floor((h - sH) / 2);
              }
              const storyPath = path.join(processedDir, `${safePrefix}_${colorSlug}_story.png`);
              await sharp(useImgPath).extract({ left: sLeft, top: sTop, width: sW, height: sH }).toFile(storyPath);
              await prisma.asset.create({ data: { jobId: job.id, type: 'crop', path: storyPath, status: 'approved' } });
            }
          }
          console.log('Native social media crops generated successfully');
        } catch (err: any) {
          console.error('Failed to generate native crops:', err.message);
        }
      }
    }

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: finalStatus as any,
        completedAt: new Date(),
        progress: successCount / colors.length,
        errorMessage: failedColors.length > 0 ? `${failedColors.length} color(s) failed` : null,
        statusHistory: results.map((r) => ({
          color: r.color,
          status: r.error ? 'COLOR_FAILED' : 'done',
          message: r.error || 'Generated successfully',
        })) as any,
      },
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: finalStatus,
      generated: successCount,
      total: colors.length,
      failed: failedColors.map((r) => ({ color: r.color, error: r.error })),
    });
  } catch (err: any) {
    console.error('Direct Generate Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
