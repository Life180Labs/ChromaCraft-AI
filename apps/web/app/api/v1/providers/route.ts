import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { encryptApiKey, decryptApiKey } from '../../../../lib/crypto';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const providers = await prisma.aiProvider.findMany({
      where: {
        // Exclude internal settings provider from the list
        NOT: { name: '__app_settings__' },
      },
      select: {
        id: true,
        name: true,
        default: true,
        apiKey: true,
      },
    });

    return NextResponse.json(
      providers.map(({ apiKey, ...provider }) => ({
        ...provider,
        // Only expose whether a key is set — never expose the key value or its encrypted form
        hasApiKey: Boolean(apiKey?.trim()),
      }))
    );
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { name, apiKey, isDefault } = await req.json();
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Sanitize name
    const safeName = name.trim().slice(0, 100);

    const existing = await prisma.aiProvider.findUnique({ where: { name: safeName } });
    const preserveKey = !apiKey || apiKey === 'unchanged';

    if (!existing && preserveKey && safeName.toLowerCase() !== 'mock') {
      return NextResponse.json({ error: 'apiKey is required for new providers' }, { status: 400 });
    }

    // Resolve and encrypt the key
    let resolvedKey: string;
    if (preserveKey && existing) {
      // Keep existing encrypted key as-is
      resolvedKey = existing.apiKey;
    } else if (preserveKey && safeName.toLowerCase() === 'mock') {
      resolvedKey = 'mock';
    } else {
      // Encrypt the new key before storing
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return NextResponse.json({ error: 'apiKey must be a non-empty string' }, { status: 400 });
      }
      resolvedKey = encryptApiKey(apiKey.trim());
    }

    if (isDefault === true) {
      await prisma.aiProvider.updateMany({
        where: { default: true },
        data: { default: false },
      });
    }

    const provider = await prisma.aiProvider.upsert({
      where: { name: safeName },
      update: {
        ...(preserveKey && existing ? {} : { apiKey: resolvedKey }),
        ...(typeof isDefault === 'boolean' ? { default: isDefault } : {}),
      },
      create: {
        name: safeName,
        apiKey: resolvedKey,
        default: !!isDefault,
      },
    });

    return NextResponse.json({
      success: true,
      provider: { id: provider.id, name: provider.name, default: provider.default },
    });
  } catch (err: any) {
    console.error('[Providers API] Error:', err.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
