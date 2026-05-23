import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';
import { limiter } from '../../../../lib/rateLimit';

export async function GET(req: NextRequest) {
  try {
    await limiter(req as any, {} as any, () => {});
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const providers = await prisma.aiProvider.findMany({
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
        hasApiKey: Boolean(apiKey?.trim()),
      }))
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await limiter(req as any, {} as any, () => {});
    const userId = await getUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { name, apiKey, isDefault } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const existing = await prisma.aiProvider.findUnique({ where: { name } });
    const preserveKey = !apiKey || apiKey === 'unchanged';

    if (!existing && preserveKey && name.toLowerCase() !== 'mock') {
      return NextResponse.json({ error: 'apiKey is required for new providers' }, { status: 400 });
    }

    const resolvedKey =
      preserveKey && existing
        ? existing.apiKey
        : preserveKey && name.toLowerCase() === 'mock'
          ? 'mock'
          : apiKey;

    if (isDefault) {
      await prisma.aiProvider.updateMany({
        where: { default: true },
        data: { default: false },
      });
    }

    const provider = await prisma.aiProvider.upsert({
      where: { name },
      update: {
        ...(preserveKey && existing ? {} : { apiKey: resolvedKey }),
        ...(typeof isDefault === 'boolean' ? { default: isDefault } : {}),
      },
      create: {
        name,
        apiKey: resolvedKey,
        default: !!isDefault,
      },
    });

    return NextResponse.json({
      success: true,
      provider: { id: provider.id, name: provider.name, default: provider.default },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
