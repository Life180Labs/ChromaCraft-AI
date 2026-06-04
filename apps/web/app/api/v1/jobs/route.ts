import prisma from '../../../../lib/prisma';
import { getUserId } from '../../../../lib/auth';
import { NextResponse } from 'next/server';

// ── GET /api/v1/jobs ──────────────────────────────────────────────────────────
// Supports pagination: ?page=1&limit=20
// For the job list (sidebar), we load summary data only — no assets included.
// Assets are fetched separately via GET /api/v1/jobs/:id when a job is selected.
//
// To keep backward compat with the frontend that expects `assets` on each job,
// we include a lightweight asset summary (id, type, status only — no path).

export async function GET(request: Request) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const skip = (page - 1) * limit;

  const [jobs, total] = await Promise.all([
    prisma.job.findMany({
      where: { userId: Number(userId) },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        // Include asset summary only (id, type, status) — not the full path/scores
        // This keeps the list response small. Full asset data is in GET /api/v1/jobs/:id
        assets: {
          select: { id: true, type: true, status: true },
        },
        generation: true,
        prompt: true,
      },
    }),
    prisma.job.count({ where: { userId: Number(userId) } }),
  ]);

  // Return with pagination metadata so frontend can implement load-more
  return NextResponse.json(jobs, {
    headers: {
      'X-Total-Count': String(total),
      'X-Page': String(page),
      'X-Limit': String(limit),
      'X-Total-Pages': String(Math.ceil(total / limit)),
    },
  });
}

// ── POST /api/v1/jobs ─────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { name, prompt } = await request.json();
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'Job name is required' }, { status: 400 });
  }

  const job = await prisma.job.create({
    data: {
      name: name.trim().slice(0, 200),
      user: { connect: { id: Number(userId) } },
      prompt: prompt ? { create: { name: 'default', content: prompt } } : undefined,
    },
  });
  return NextResponse.json(job, { status: 201 });
}

// ── PUT /api/v1/jobs ──────────────────────────────────────────────────────────
export async function PUT(request: Request) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { id, status, name, prompt, settings } = await request.json();
  if (!id || isNaN(Number(id))) {
    return NextResponse.json({ error: 'Valid job ID required' }, { status: 400 });
  }

  const job = await prisma.job.update({
    where: { id: Number(id), userId: Number(userId) },
    data: {
      status: status || undefined,
      name: name ? name.trim().slice(0, 200) : undefined,
      prompt: prompt ? {
        upsert: {
          create: { name: 'generation-prompt', content: prompt },
          update: { content: prompt },
        }
      } : undefined,
      generation: settings ? {
        upsert: {
          create: { metadata: settings },
          update: { metadata: settings },
        }
      } : undefined,
    },
  });
  return NextResponse.json(job);
}

// ── DELETE /api/v1/jobs ───────────────────────────────────────────────────────
export async function DELETE(request: Request) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { id } = await request.json();
  if (!id || isNaN(Number(id))) {
    return NextResponse.json({ error: 'Valid job ID required' }, { status: 400 });
  }

  // Verify ownership before deletion
  const job = await prisma.job.findFirst({ where: { id: Number(id), userId: Number(userId) } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  await prisma.$transaction([
    prisma.asset.deleteMany({ where: { jobId: Number(id) } }),
    prisma.generation.deleteMany({ where: { jobId: Number(id) } }),
    prisma.generationConfig.deleteMany({ where: { jobId: Number(id) } }),
    prisma.jobEvent.deleteMany({ where: { jobId: Number(id) } }),
    prisma.iteration.deleteMany({ where: { jobId: Number(id) } }),
    prisma.job.delete({ where: { id: Number(id) } }),
  ]);

  return NextResponse.json({ message: 'Job deleted' });
}
