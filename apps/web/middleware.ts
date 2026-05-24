import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple in-memory Map for rate limiting. 
// Note: In serverless environments, this state is not shared across instances,
// but it is sufficient for local development and basic single-instance limits.
const ipMap = new Map<string, { count: number; lastReset: number }>();

const RATE_LIMIT = 100; // max requests
const WINDOW_MS = 60 * 1000; // 1 minute

export function middleware(request: NextRequest) {
  // Only apply to /api/v1/* routes
  if (request.nextUrl.pathname.startsWith('/api/v1/')) {
    // Extract IP from headers
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1';
    
    const now = Date.now();
    const record = ipMap.get(ip);

    if (!record) {
      ipMap.set(ip, { count: 1, lastReset: now });
    } else {
      if (now - record.lastReset > WINDOW_MS) {
        // Reset window after 1 minute
        ipMap.set(ip, { count: 1, lastReset: now });
      } else {
        record.count++;
        if (record.count > RATE_LIMIT) {
          return NextResponse.json(
            { error: 'Too Many Requests' },
            { status: 429 }
          );
        }
      }
    }
  }

  return NextResponse.next();
}

// Ensure the middleware only runs on API routes to avoid overhead on static/UI routes
export const config = {
  matcher: '/api/v1/:path*',
};
