import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';

// Allowed Gemini model values (allowlist for security)
const ALLOWED_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash',
  'gemini-3.1-pro',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.5-flash-preview-05-20',
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

function defaultSettings() {
  return {
    geminiImageModel: 'gemini-2.0-flash-preview-image-generation',
    geminiVideoModel: 'veo-2.0-generate-001',
    defaultGridCols: 4,
    defaultGridRows: 3,
  };
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    // Try AppSettings table first (new schema)
    try {
      const settings = await (prisma as any).appSettings?.findUnique({ where: { id: 1 } });
      if (settings) {
        return NextResponse.json({
          geminiImageModel: settings.geminiImageModel,
          geminiVideoModel: settings.geminiVideoModel,
          defaultGridCols: settings.defaultGridCols,
          defaultGridRows: settings.defaultGridRows,
        });
      }
    } catch {
      // AppSettings table may not exist yet (pre-migration) — fall through to legacy
    }

    // Legacy: read from __app_settings__ AiProvider record
    try {
      const record = await prisma.aiProvider.findUnique({
        where: { name: '__app_settings__' },
      });
      if (record) {
        const parsed = JSON.parse(record.apiKey);
        return NextResponse.json({ ...defaultSettings(), ...parsed });
      }
    } catch { }

    return NextResponse.json(defaultSettings());
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = await req.json();
    const { geminiImageModel, geminiVideoModel, defaultGridCols, defaultGridRows } = body;

    // Validate model values against allowlist
    if (geminiImageModel && !ALLOWED_IMAGE_MODELS.includes(geminiImageModel)) {
      return NextResponse.json(
        { error: `Invalid geminiImageModel. Allowed: ${ALLOWED_IMAGE_MODELS.join(', ')}` },
        { status: 400 },
      );
    }
    if (geminiVideoModel && !ALLOWED_VIDEO_MODELS.includes(geminiVideoModel)) {
      return NextResponse.json(
        { error: `Invalid geminiVideoModel. Allowed: ${ALLOWED_VIDEO_MODELS.join(', ')}` },
        { status: 400 },
      );
    }

    const updateData = {
      ...(geminiImageModel ? { geminiImageModel } : {}),
      ...(geminiVideoModel ? { geminiVideoModel } : {}),
      ...(defaultGridCols ? { defaultGridCols: Number(defaultGridCols) } : {}),
      ...(defaultGridRows ? { defaultGridRows: Number(defaultGridRows) } : {}),
    };

    // Try AppSettings table (new schema)
    try {
      const settings = await (prisma as any).appSettings?.upsert({
        where: { id: 1 },
        update: updateData,
        create: { id: 1, ...defaultSettings(), ...updateData },
      });
      return NextResponse.json({ success: true, settings });
    } catch {
      // AppSettings table not yet available (pre-migration) — fall through to legacy
    }

    // Legacy fallback: store in __app_settings__ AiProvider record
    const current = await prisma.aiProvider.findUnique({ where: { name: '__app_settings__' } });
    let existing: Record<string, any> = defaultSettings();
    if (current) {
      try { existing = { ...existing, ...JSON.parse(current.apiKey) }; } catch { }
    }

    const updated = { ...existing, ...updateData };

    await prisma.aiProvider.upsert({
      where: { name: '__app_settings__' },
      update: { apiKey: JSON.stringify(updated) },
      create: { name: '__app_settings__', apiKey: JSON.stringify(updated), default: false },
    });

    return NextResponse.json({ success: true, settings: updated });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
