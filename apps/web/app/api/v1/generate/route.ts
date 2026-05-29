import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { generateQueue } from '../../../../lib/bullmq';
import { GenerateRequestSchema } from '../../../../lib/validations';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = await req.json();

    // Zod validation
    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      }, { status: 400 });
    }

    const { jobId, prompt, providerId, settings } = parsed.data;

    // Verify job ownership
    const job = await prisma.job.findFirst({
      where: { id: Number(jobId), userId: Number(userId) },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    // Determine AI Provider
    let activeProvider = null;
    if (providerId) {
      activeProvider = await prisma.aiProvider.findUnique({ where: { id: Number(providerId) } });
    } else {
      activeProvider = await prisma.aiProvider.findFirst({ where: { default: true } });
      if (!activeProvider) activeProvider = await prisma.aiProvider.findFirst();
    }

    if (!activeProvider || activeProvider.name.toLowerCase() === 'mock') {
      return NextResponse.json({
        error: 'No active AI Provider configured. Configure Stability AI in Profile Settings.',
      }, { status: 400 });
    }

    const providerName = activeProvider.name;
    const apiKey = activeProvider.apiKey;

    // Save generation config
    const safePrefix = (settings?.prefix || job.name)
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '');

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'PROCESSING',
        provider: { connect: { id: activeProvider.id } },
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
        generationConfig: {
          upsert: {
            create: {
              strategy: (settings as any)?.strategy || 'STABILITY_SEARCH_REPLACE',
              denoiseStrength: (settings as any)?.denoiseStrength ?? 0.4,
              controlNetEnabled: (settings as any)?.identityLock !== false,
              identityLock: (settings as any)?.identityLock !== false,
              seed: 42,
              colors: settings?.colors || [],
              gridCols: settings?.cols || 4,
              gridRows: settings?.rows || 3,
              spinFrames: settings?.spinFrames || 36,
              qualityThreshold: (settings as any)?.qualityThreshold ?? 0.92,
            },
            update: {
              strategy: (settings as any)?.strategy || 'STABILITY_SEARCH_REPLACE',
              denoiseStrength: (settings as any)?.denoiseStrength ?? 0.4,
            },
          },
        },
      },
    });

    const catalogSettings = {
      prefix: safePrefix,
      colors: settings?.colors || [],
      cols: settings?.cols || 4,
      rows: settings?.rows || 3,
      industry: settings?.industry || 'Automotive',
      targetMarket: settings?.targetMarket || 'Global',
      targetAudience: settings?.targetAudience || 'General consumers',
      targetPurpose: settings?.targetPurpose || 'Product catalog',
      lifestyleEnabled: settings?.lifestyleEnabled ?? false,
      videoEnabled: settings?.videoEnabled ?? false,
      spinEnabled: settings?.spinEnabled ?? false,
      cropsEnabled: settings?.cropsEnabled ?? false,
      imageSize: settings?.imageSize || '800x600',
      spinFrames: settings?.spinFrames || 36,
      fps: settings?.fps || 12,
      strategy: (settings as any)?.strategy || 'stability',
      denoiseStrength: (settings as any)?.denoiseStrength ?? 0.4,
      qualityThreshold: (settings as any)?.qualityThreshold ?? 0.92,
      identityLock: (settings as any)?.identityLock !== false,
      additionalContext: (settings as any)?.additionalContext,
    };

    // Enqueue
    const originalAsset = await prisma.asset.findFirst({
      where: { jobId: job.id, type: 'original' }
    });

    await generateQueue.add('process-generation', {
      jobId: job.id,
      prompt,
      provider: providerName,
      apiKey,
      settings: catalogSettings,
      refImagePath: originalAsset?.path,
    });

    return NextResponse.json({
      success: true,
      message: 'Identity-preserving generation started',
      jobId: job.id,
      provider: providerName,
      strategy: catalogSettings.strategy,
      qualityThreshold: catalogSettings.qualityThreshold,
      colorCount: catalogSettings.colors.length || catalogSettings.cols * catalogSettings.rows,
    });
  } catch (err: any) {
    console.error('Generate API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
