import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { generateQueue } from '../../../../lib/bullmq';
import { limiter } from '../../../../lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    await limiter(req as any, {} as any, () => {});

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
      where: {
        id: Number(jobId),
        userId: Number(userId),
      },
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Determine AI Provider
    let activeProvider = null;
    if (providerId) {
      activeProvider = await prisma.aiProvider.findUnique({
        where: { id: Number(providerId) },
      });
    } else {
      activeProvider = await prisma.aiProvider.findFirst({
        where: { default: true },
      });
      if (!activeProvider) {
        activeProvider = await prisma.aiProvider.findFirst();
      }
    }

    // If no provider set in DB, allow falling back to env/defaults
    const providerName = activeProvider?.name || process.env.AI_PROVIDER_DEFAULT || 'mock';
    const apiKey = activeProvider?.apiKey || process.env.AI_OPENAI_KEY || '';

    // Update job status & connect provider using checked relation format
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

    // Enqueue generation in BullMQ
    await generateQueue.add('process-generation', {
      jobId: job.id,
      prompt,
      provider: providerName,
      apiKey,
      settings: settings || {},
    });

    return NextResponse.json({ success: true, message: 'Generation started' });
  } catch (err: any) {
    console.error('Generate API Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
