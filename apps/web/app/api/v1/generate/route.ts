import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { generateQueue } from '../../../../lib/bullmq';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { jobId, prompt, providerId, settings } = body;

    if (!jobId || !prompt) {
      return NextResponse.json({ error: 'jobId and prompt are required' }, { status: 400 });
    }

    // Verify job belongs to user
    const job = await prisma.job.findFirst({
      where: { id: Number(jobId), userId: Number(userId) },
    });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Determine AI Provider
    let activeProvider = null;
    if (providerId) {
      activeProvider = await prisma.aiProvider.findUnique({ where: { id: Number(providerId) } });
    } else {
      activeProvider = await prisma.aiProvider.findFirst({ where: { default: true } });
      if (!activeProvider) activeProvider = await prisma.aiProvider.findFirst();
    }

    if (!activeProvider || activeProvider.name.toLowerCase() === 'mock') {
      return NextResponse.json({ error: 'No active AI Provider configured. Please configure OpenAI or Stability AI in Profile Settings to use standard generation.' }, { status: 400 });
    }

    const providerName = activeProvider.name;
    const apiKey = activeProvider.apiKey;

    // Update job status
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'PROCESSING',
        provider: activeProvider ? { connect: { id: activeProvider.id } } : undefined,
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

    // Build catalog settings — propagate EVERY frontend setting to the worker
    const safePrefix = (settings?.prefix || job.name)
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '');

    const catalogSettings = {
      // Grid / colors
      prefix: safePrefix,
      colors: settings?.colors || [],
      cols: settings?.cols || 4,
      rows: settings?.rows || 3,

      // Domain context
      industry: settings?.industry || 'Automotive',
      targetMarket: settings?.targetMarket || 'Global',
      targetAudience: settings?.targetAudience || 'General consumers',
      targetPurpose: settings?.targetPurpose || 'Product catalog',

      // Pipeline flags
      lifestyleEnabled: Boolean(settings?.lifestyleEnabled),
      videoEnabled: Boolean(settings?.videoEnabled),
      spinEnabled: Boolean(settings?.spinEnabled),
      cropsEnabled: Boolean(settings?.cropsEnabled),

      // Image dimensions: 800×600 per catalog image
      imageSize: settings?.imageSize || '800x600',

      // Spin / video params
      spinFrames: settings?.spinFrames || 36,
      fps: settings?.fps || 12,
    };

    // Enqueue generation in BullMQ
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
      message: 'Generation started',
      jobId: job.id,
      provider: providerName,
      colorCount: catalogSettings.colors.length || catalogSettings.cols * catalogSettings.rows,
      spinEnabled: catalogSettings.spinEnabled,
      videoEnabled: catalogSettings.videoEnabled,
    });
  } catch (err: any) {
    console.error('Generate API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
