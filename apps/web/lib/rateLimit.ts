import rateLimit from 'express-rate-limit';
import type { NextApiRequest, NextApiResponse } from 'next';

// Using Next.js Edge runtime, we implement a simple wrapper
export const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || 30,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

export default async function rateLimitMiddleware(req: NextApiRequest, res: NextApiResponse, next: () => void) {
  // @ts-ignore – rateLimit expects Express req/res
  await limiter(req, res, next);
}
