import prisma from '../../../../lib/prisma';
import { getUserId } from '../../../../lib/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const jobs = await prisma.job.findMany({
    where: { userId: Number(userId) },
    include: {
      assets: true,
      generation: true,
      prompt: true,
    }
  });
  return NextResponse.json(jobs);
}

export async function POST(request: Request) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { name, prompt } = await request.json();
  const job = await prisma.job.create({
    data: {
      name: name || 'Untitled',
      user: { connect: { id: Number(userId) } },
      prompt: prompt ? { create: { name: 'default', content: prompt } } : undefined,
    },
  });
  return NextResponse.json(job, { status: 201 });
}

export async function PUT(request: Request) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id, status, name, prompt, settings } = await request.json();
  const job = await prisma.job.update({
    where: { id: Number(id), userId: Number(userId) },
    data: {
      status: status || undefined,
      name: name || undefined,
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

export async function DELETE(request: Request) {
  const userId = await getUserId(request as any);
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id } = await request.json();
  
  await prisma.$transaction([
    prisma.asset.deleteMany({ where: { jobId: Number(id) } }),
    prisma.generation.deleteMany({ where: { jobId: Number(id) } }),
    prisma.job.delete({ where: { id: Number(id), userId: Number(userId) } })
  ]);
  
  return NextResponse.json({ message: 'Job deleted' });
}
