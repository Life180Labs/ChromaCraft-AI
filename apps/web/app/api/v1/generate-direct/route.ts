import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

function runPythonScript(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const py = spawn('python', args);
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    py.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    py.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

// ─── Gemini direct generation (no BullMQ) ───────────────────────────────────

async function generateColorVariantWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
  referenceImageBase64: string,
  referenceImageMime: string,
  colorName: string,
): Promise<Buffer | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const colorPrompt = prompt.replace(/\[COLOR\]/gi, colorName).replace(/\[color\]/gi, colorName);

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
            text: colorPrompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
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

  return null;
}

async function generateVideoWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
  referenceImageBase64: string,
  referenceImageMime: string,
): Promise<Buffer | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`;

  const body = {
    instances: [
      {
        prompt: prompt,
        image: {
          mimeType: referenceImageMime,
          bytesBase64Encoded: referenceImageBase64,
        },
      },
    ],
    parameters: {
      aspectRatio: '16:9',
      resolution: '720p',
      durationSeconds: 5,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini Video API error (${res.status}): ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const operationName = data?.name;
  if (!operationName) {
    throw new Error(`No operation name returned for long-running video generation: ${JSON.stringify(data)}`);
  }

  console.log(`Successfully started video generation task. Operation: ${operationName}. Polling for completion...`);

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
  
  // Poll every 5 seconds for a maximum of 120 seconds
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    
    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) {
      console.warn(`Polling attempt ${attempt + 1} failed: ${pollRes.status}`);
      continue;
    }
    
    const pollData = await pollRes.json();
    if (pollData.done) {
      if (pollData.error) {
        throw new Error(`Video generation operation failed: ${pollData.error.message || JSON.stringify(pollData.error)}`);
      }
      
      const response = pollData.response;
      const generatedVideos = response?.generatedVideos || [];
      for (const videoObj of generatedVideos) {
        const bytes = videoObj?.video?.bytesBase64Encoded || videoObj?.video?.videoBytes;
        if (bytes) {
          return Buffer.from(bytes, 'base64');
        }
      }
      
      throw new Error(`Operation marked done but no video data found in response: ${JSON.stringify(pollData)}`);
    }
  }

  throw new Error(`Video generation timed out after 120 seconds.`);
}

async function generateSpinFrameWithGemini(
  apiKey: string,
  model: string,
  referenceImageBase64: string,
  referenceImageMime: string,
  angle: number,
): Promise<Buffer | null> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Locked geometry prompt per angle
  const prompt = `Generate a high-quality product photo of the item rotated horizontally by exactly ${angle} degrees relative to the camera. Maintain locked geometry, original colors, texture, shape, proportions, and details perfectly. Show the product on a clean studio white background under uniform lighting.`;

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
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini Image API error (${res.status}): ${errText.slice(0, 500)}`);
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

  return null;
}

// ─── Main handler ────────────────────────────────────────────────────────────

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

    // Generate per color concurrently (max 3 at a time)
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

        // Save file
        const safeColor = colorName.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
        const filename = `raw_${safeColor}.png`;
        const filePath = path.join(jobAssetDir, filename);
        await writeFile(filePath, imgBuffer);

        // Upsert asset in DB
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

      // 1. Grid generation
      const gridScript = path.join(process.cwd(), '..', 'worker', 'python', 'grid.py');
      const gridPath = path.join(jobAssetDir, `grid_${safePrefix}.png`);
      const imagePaths = successResults.map(r => r.filePath!);
      const labels = successResults.map(r => r.color);
      const cols = settings?.cols || 4;

      const gridArgs = [
        gridScript,
        '--images', ...imagePaths,
        '--output', gridPath,
        '--cols', String(cols),
        '--labels', ...labels,
        '--spacing', '15',
        '--padding', '25',
        '--borderRadius', '6',
        '--watermark', 'ChromaCraft AI',
        '--jsonMode'
      ];

      try {
        const { exitCode, stderr } = await runPythonScript(gridArgs);
        if (exitCode === 0 && require('fs').existsSync(gridPath)) {
          await prisma.asset.deleteMany({
            where: { jobId: job.id, type: 'grid' }
          });
          await prisma.asset.create({
            data: { jobId: job.id, type: 'grid', path: gridPath, status: 'pending' }
          });
        } else {
          console.error('Grid generation script failed:', stderr);
        }
      } catch (err) {
        console.error('Failed to run grid.py:', err);
      }

      // 2. Video generation
      if (settings?.videoEnabled === true) {
        const videoModel = settings?.videoModel || 'veo-2.0-generate-001';
        const videoPromptText = settings?.videoPrompt || 'Cinematic showcase of the product under dynamic studio lighting';
        const videoPath = path.join(jobAssetDir, `${safePrefix}_showcase.mp4`);

        let generatedVideoBuffer: Buffer | null = null;
        try {
          console.log(`Attempting Gemini video generation with model: ${videoModel}`);
          generatedVideoBuffer = await generateVideoWithGemini(
            geminiProvider.apiKey,
            videoModel,
            videoPromptText,
            refImageBase64,
            refImageMime
          );
        } catch (err: any) {
          console.error('Gemini Video generation failed:', err.message);
        }

        if (generatedVideoBuffer) {
          try {
            await writeFile(videoPath, generatedVideoBuffer);
            await prisma.asset.deleteMany({ where: { jobId: job.id, type: 'video' } });
            await prisma.asset.create({
              data: { jobId: job.id, type: 'video', path: videoPath, status: 'pending' }
            });
            console.log('Video generated via Gemini model successfully');
          } catch (err) {
            console.error('Failed to write Gemini video to disk:', err);
          }
        }
      }

      // 2.5 360 Spin generation (0° to 350° in 10° steps)
      if (settings?.spinEnabled === true) {
        console.log('Starting 360 spin frame generation using Image-to-Image...');
        const angles = Array.from({ length: 36 }, (_, i) => i * 10);
        const spinResults: { angle: number; filePath: string }[] = [];

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
              spinResults.push({ angle, filePath });
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
          // Compile turntable GIF using multiview.py
          const spinScript = path.join(process.cwd(), '..', 'worker', 'python', 'multiview.py');
          const turntableGifPath = path.join(jobAssetDir, `${safePrefix}_turntable.gif`);
          const spinArgs = [
            spinScript,
            '--task', 'turntable_gif',
            '--refImage', originalAsset.path,
            '--outDir', jobAssetDir,
            '--prefix', safePrefix,
            '--jsonMode'
          ];
          try {
            console.log('Compiling turntable GIF with multiview.py...');
            const { exitCode, stderr } = await runPythonScript(spinArgs);
            if (exitCode === 0 && require('fs').existsSync(turntableGifPath)) {
              console.log('Turntable GIF compiled successfully at:', turntableGifPath);
              await prisma.asset.deleteMany({
                where: { jobId: job.id, type: 'spin' }
              });
              await prisma.asset.create({
                data: { jobId: job.id, type: 'spin', path: turntableGifPath, status: 'pending' }
              });
            } else {
              console.error('Failed to compile turntable GIF:', stderr);
            }
          } catch (err) {
            console.error('Failed to run turntable GIF compilation script:', err);
          }
        }
      }

      // 3. Background removal and social crops
      const processScript = path.join(process.cwd(), '..', 'worker', 'python', 'process.py');
      const processedDir = path.join(jobAssetDir, 'processed');
      
      const processArgs = [
        processScript,
        '--inputDir', jobAssetDir,
        '--outputDir', processedDir,
        '--prefix', safePrefix,
        '--refImage', originalAsset.path,
        '--jsonMode'
      ];
      if (settings?.cropsEnabled !== false) {
        processArgs.push('--socialCrops');
      }

      try {
        console.log('Running process.py for background removal and social crops...');
        const { exitCode, stderr } = await runPythonScript(processArgs);
        if (exitCode === 0) {
          console.log('process.py finished successfully');
          if (require('fs').existsSync(processedDir)) {
            const files = require('fs').readdirSync(processedDir);
            for (const file of files) {
              if (file.endsWith('.png')) {
                const filePath = path.join(processedDir, file);
                const isCrop = file.includes('_instagram') || file.includes('_banner') || file.includes('_story');
                const assetType = isCrop ? 'crop' : 'processed';
                
                await prisma.asset.deleteMany({
                  where: { jobId: job.id, type: assetType, path: filePath }
                });
                await prisma.asset.create({
                  data: { jobId: job.id, type: assetType, path: filePath, status: 'approved' } // Auto-approve post-processed assets
                });
              }
            }
          }
        } else {
          console.error('process.py failed:', stderr);
        }
      } catch (err) {
        console.error('Failed to run process.py:', err);
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
