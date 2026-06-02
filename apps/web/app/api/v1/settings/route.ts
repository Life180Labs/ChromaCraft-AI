import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';

// We store model preferences inside the AiProvider record metadata
// by using a special "settings" provider record, or we piggyback on a JSON column.
// Simplest approach: store in a dedicated AiProvider named "settings" with the
// model prefs serialized in the apiKey field as JSON (sentinel approach).

const SETTINGS_PROVIDER_NAME = '__app_settings__';

function defaultSettings() {
  return {
    geminiImageModel: 'gemini-2.0-flash-preview-image-generation',
    geminiVideoModel: 'veo-2.0-generate-001',
  };
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const record = await prisma.aiProvider.findUnique({
      where: { name: SETTINGS_PROVIDER_NAME },
    });

    if (!record) {
      return NextResponse.json(defaultSettings());
    }

    try {
      const parsed = JSON.parse(record.apiKey);
      return NextResponse.json({ ...defaultSettings(), ...parsed });
    } catch {
      return NextResponse.json(defaultSettings());
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = await req.json();
    const { geminiImageModel, geminiVideoModel } = body;

    const current = await prisma.aiProvider.findUnique({
      where: { name: SETTINGS_PROVIDER_NAME },
    });

    let existing: Record<string, string> = defaultSettings();
    if (current) {
      try { existing = { ...existing, ...JSON.parse(current.apiKey) }; } catch {}
    }

    const updated = {
      ...existing,
      ...(geminiImageModel ? { geminiImageModel } : {}),
      ...(geminiVideoModel ? { geminiVideoModel } : {}),
    };

    await prisma.aiProvider.upsert({
      where: { name: SETTINGS_PROVIDER_NAME },
      update: { apiKey: JSON.stringify(updated) },
      create: { name: SETTINGS_PROVIDER_NAME, apiKey: JSON.stringify(updated), default: false },
    });

    return NextResponse.json({ success: true, settings: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
