/**
 * POST /api/v1/generate
 *
 * Single, unified generation endpoint.
 *
 * Previously this routed to the Stability AI BullMQ worker via orchestrator.ts.
 * Now it forwards to the Gemini-direct pipeline exclusively, which:
 *   1. Validates inputs with Zod
 *   2. Generates color variants via Gemini image API
 *   3. Assembles a grid with sharp
 *   4. Enqueues video to veoVideoWorker (async, non-blocking)
 *   5. Optionally generates 360-spin frames and social crops
 *
 * The generate-direct handler lives at:
 *   apps/web/app/api/v1/generate-direct/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { GenerateRequestSchema } from '../../../../lib/validations';
import { decryptApiKey } from '../../../../lib/crypto';

// ── Allowed model allowlists (must match generate-direct) ─────────────────────
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

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = await req.json();

    // Validate with Zod
    const parsed = GenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      }, { status: 400 });
    }

    const { jobId, prompt, settings } = parsed.data;

    // Verify job ownership + has a reference image
    const job = await prisma.job.findFirst({
      where: { id: Number(jobId), userId: Number(userId) },
      include: { assets: { where: { type: 'original' } } },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (job.assets.length === 0) {
      return NextResponse.json(
        { error: 'No reference image found. Please upload a product image first.' },
        { status: 400 },
      );
    }

    // Verify Gemini API key is configured
    const geminiProvider = await prisma.aiProvider.findFirst({
      where: {
        name: { contains: 'gemini', mode: 'insensitive' },
        NOT: { name: '__app_settings__' },
      },
    });
    if (!geminiProvider?.apiKey) {
      return NextResponse.json(
        { error: 'Gemini API key not configured. Add it in Profile → API Keys.' },
        { status: 400 },
      );
    }
    // Validate key is decryptable (catches key rotation/corruption early)
    try { decryptApiKey(geminiProvider.apiKey); } catch {
      return NextResponse.json(
        { error: 'Gemini API key is misconfigured. Please re-enter it in Profile → API Keys.' },
        { status: 400 },
      );
    }

    // Read app settings for model defaults
    let imageModel = 'gemini-3-pro-image';
    let videoModel = 'veo-3.1-generate-preview';
    try {
      const appSettings = await (prisma as any).appSettings?.findUnique({ where: { id: 1 } });
      if (appSettings) {
        imageModel = appSettings.geminiImageModel || imageModel;
        videoModel = appSettings.geminiVideoModel || videoModel;
      }
    } catch { /* AppSettings table may not exist yet */ }

    // Override with request-level settings if provided and valid
    const requestedImageModel = (settings as any)?.imageModel;
    const requestedVideoModel = (settings as any)?.videoModel;
    if (requestedImageModel && ALLOWED_IMAGE_MODELS.includes(requestedImageModel)) {
      imageModel = requestedImageModel;
    }
    if (requestedVideoModel && ALLOWED_VIDEO_MODELS.includes(requestedVideoModel)) {
      videoModel = requestedVideoModel;
    }

    // Forward to generate-direct handler by constructing an internal fetch
    // This keeps a single implementation point (generate-direct) while allowing
    // the /api/v1/generate route to remain the stable, documented API surface.
    const internalUrl = new URL('/api/v1/generate-direct', req.url);

    const forwardBody = {
      jobId: Number(jobId),
      prompt,
      settings: {
        ...((settings as any) || {}),
        imageModel,
        videoModel,
      },
    };

    // Copy auth cookies for the internal request
    const forwardRes = await fetch(internalUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: req.headers.get('Cookie') || '',
        'x-forwarded-for': req.headers.get('x-forwarded-for') || '',
      },
      body: JSON.stringify(forwardBody),
    });

    const responseData = await forwardRes.json();
    return NextResponse.json(responseData, { status: forwardRes.status });
  } catch (err: any) {
    console.error('[Generate] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
