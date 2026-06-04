import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Redis-backed sliding window rate limiter ──────────────────────────────────
//
// Uses the existing Redis instance via REST (compatible with Next.js middleware
// edge runtime which cannot use IORedis/TCP sockets directly).
//
// Strategy: fixed-window INCR + EXPIRE via Redis REST API (Upstash-compatible).
// If Redis is unreachable, falls back silently to in-memory limiter so the app
// never breaks from a Redis outage.

const RATE_LIMIT = 100;        // max requests per window per IP+route
const WINDOW_SECONDS = 60;     // 1-minute sliding window
const GEN_RATE_LIMIT = 5;      // stricter limit for expensive generation routes
const GEN_WINDOW_SECONDS = 60;

// ── In-memory fallback ────────────────────────────────────────────────────────
const memoryStore = new Map<string, { count: number; resetAt: number }>();

function memoryRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const record = memoryStore.get(key);

  if (!record || now > record.resetAt) {
    const resetAt = now + windowMs;
    memoryStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  record.count++;
  const remaining = Math.max(0, limit - record.count);
  return { allowed: record.count <= limit, remaining, resetAt: record.resetAt };
}

// ── Redis REST rate limiter ───────────────────────────────────────────────────
// Works in edge middleware via standard fetch (no TCP sockets).
// Falls back to memory if REDIS_REST_URL is not configured.

async function redisRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number } | null> {
  const redisRestUrl = process.env.REDIS_REST_URL;
  const redisRestToken = process.env.REDIS_REST_TOKEN;

  if (!redisRestUrl || !redisRestToken) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 200); // 200ms timeout

    // Pipeline: INCR key, EXPIRE key windowSec (only if key is new)
    const res = await fetch(`${redisRestUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisRestToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, windowSec, 'NX'], // NX = only set expiry if key has no TTL
        ['TTL', key],
      ]),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    const count = data[0]?.result ?? 1;
    const ttl = data[2]?.result ?? windowSec;
    const resetAt = Date.now() + ttl * 1000;
    const remaining = Math.max(0, limit - count);

    return { allowed: count <= limit, remaining, resetAt };
  } catch {
    return null; // Redis unreachable — fall back to memory
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Only apply to /api/v1/* routes
  if (!path.startsWith('/api/v1/')) {
    return NextResponse.next();
  }

  // Skip rate limiting for long-lived connections
  if (path === '/api/v1/events' || path.startsWith('/api/v1/events/')) {
    return NextResponse.next();
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  // Use tighter limits for expensive generation endpoints
  const isGenRoute = path.includes('/generate') || path.includes('/export');
  const limit = isGenRoute ? GEN_RATE_LIMIT : RATE_LIMIT;
  const windowSec = isGenRoute ? GEN_WINDOW_SECONDS : WINDOW_SECONDS;

  // Route prefix for key scoping (e.g. "generate-direct", "jobs", "upload")
  const routePrefix = path.split('/')[3] || 'api';
  const key = `rl:${ip}:${routePrefix}`;

  // Try Redis first, fall back to memory
  const result =
    (await redisRateLimit(key, limit, windowSec)) ??
    memoryRateLimit(key, limit, windowSec);

  const resetSec = Math.ceil(result.resetAt / 1000);

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before retrying.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(windowSec),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetSec),
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', String(resetSec));
  return response;
}

export const config = {
  matcher: '/api/v1/:path*',
};
