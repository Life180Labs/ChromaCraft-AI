import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';

/**
 * GET /api/v1/health
 *
 * Health check endpoint (P5.2) for load balancers, monitoring, and readiness probes.
 * Checks: DB connectivity, Redis (optional), storage directory.
 *
 * Returns 200 if all critical services are healthy, 503 if any are degraded.
 */
export async function GET() {
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; detail?: string }> = {};
  let overall: 'healthy' | 'degraded' = 'healthy';

  // ── 1. Database ──────────────────────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.database = { status: 'error', detail: err.message };
    overall = 'degraded';
  }

  // ── 2. Redis ─────────────────────────────────────────────────────────────────
  const redisStart = Date.now();
  try {
    const { connection } = await import('../../../../lib/bullmq');
    await connection.ping();
    checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch (err: any) {
    // Redis degraded is a warning, not critical (rate limiter falls back to memory)
    checks.redis = { status: 'error', detail: err.message };
    // Don't mark overall as degraded — Redis outage has an in-memory fallback
  }

  // ── 3. Storage directory ─────────────────────────────────────────────────────
  try {
    const { existsSync } = await import('fs');
    const path = await import('path');
    const storagePath = process.env.STORAGE_PATH || path.join(process.cwd(), '..', '..', 'storage');
    checks.storage = existsSync(storagePath)
      ? { status: 'ok' }
      : { status: 'error', detail: `Storage directory not found: ${storagePath}` };
    if (checks.storage.status === 'error') overall = 'degraded';
  } catch (err: any) {
    checks.storage = { status: 'error', detail: err.message };
    overall = 'degraded';
  }

  // ── 4. Environment sanity ────────────────────────────────────────────────────
  const hasGeminiKey = !!(await prisma.aiProvider.findFirst({
    where: { name: { contains: 'gemini', mode: 'insensitive' }, apiKey: { not: null } },
  }).catch(() => null));

  checks.geminiConfigured = hasGeminiKey
    ? { status: 'ok' }
    : { status: 'error', detail: 'No Gemini API key configured' };

  const httpStatus = overall === 'healthy' ? 200 : 503;

  return NextResponse.json(
    {
      status: overall,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptime: Math.floor(process.uptime()),
      checks,
    },
    {
      status: httpStatus,
      headers: { 'Cache-Control': 'no-cache, no-store' },
    },
  );
}
