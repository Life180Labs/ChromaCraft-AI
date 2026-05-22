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
        // Omit apiKey for security
      },
    });
    return NextResponse.json(providers);
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
    if (!name || !apiKey) {
      return NextResponse.json({ error: 'name and apiKey are required' }, { status: 400 });
    }

    // If setting as default, unset others first
    if (isDefault) {
      await prisma.aiProvider.updateMany({
        where: { default: true },
        data: { default: false },
      });
    }

    const provider = await prisma.aiProvider.upsert({
      where: { name },
      update: { apiKey, default: !!isDefault },
      create: { name, apiKey, default: !!isDefault },
    });

    return NextResponse.json({
      success: true,
      provider: { id: provider.id, name: provider.name, default: provider.default },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
