/**
 * Structured logger for ChromaCraft-AI (P5.1)
 *
 * Wraps console with structured JSON output in production,
 * and readable colored output in development.
 * 
 * Usage:
 *   import log from '@/lib/logger';
 *   log.info({ jobId: 123, color: 'Blue' }, 'Color generated');
 *   log.error({ err, jobId: 123 }, 'Generation failed');
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  [key: string]: any;
}

const isDev = process.env.NODE_ENV !== 'production';

function formatProd(level: LogLevel, meta: LogMeta, message: string) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    service: 'chromacraft-web',
    ...meta,
    // Serialize Error objects
    ...(meta.err instanceof Error
      ? { err: { message: meta.err.message, stack: meta.err.stack?.split('\n').slice(0, 5) } }
      : {}),
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

function formatDev(level: LogLevel, meta: LogMeta, message: string) {
  const colors: Record<LogLevel, string> = {
    debug: '\x1b[37m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
  };
  const reset = '\x1b[0m';
  const prefix = `${colors[level]}[${level.toUpperCase()}]${reset}`;
  const metaStr = Object.keys(meta).length
    ? ' ' + JSON.stringify(meta, null, 0)
    : '';
  console.log(`${prefix} ${message}${metaStr}`);
}

function log(level: LogLevel, metaOrMessage: LogMeta | string, message?: string) {
  let meta: LogMeta = {};
  let msg: string;

  if (typeof metaOrMessage === 'string') {
    msg = metaOrMessage;
  } else {
    meta = metaOrMessage;
    msg = message || '';
  }

  if (isDev) {
    formatDev(level, meta, msg);
  } else {
    formatProd(level, meta, msg);
  }
}

const logger = {
  debug: (meta: LogMeta | string, message?: string) => log('debug', meta as any, message),
  info: (meta: LogMeta | string, message?: string) => log('info', meta as any, message),
  warn: (meta: LogMeta | string, message?: string) => log('warn', meta as any, message),
  error: (meta: LogMeta | string, message?: string) => log('error', meta as any, message),
};

export default logger;

// ── Cost tracking helpers (P5.3) ──────────────────────────────────────────────
// Rough cost estimates based on public Gemini pricing (May 2026).
// These are approximations for budget awareness — not billing.

export const COST_PER_IMAGE_USD = 0.0004;   // gemini-2.0-flash-preview-image-generation
export const COST_PER_VIDEO_USD = 0.030;    // veo-2.0-generate-001 per 8s clip

export function logGenerationCost(
  jobId: number,
  imagesGenerated: number,
  videoGenerated: boolean,
  failed: number,
  imageModel: string = 'gemini-2.0-flash-preview-image-generation',
  videoModel: string = 'veo-2.0-generate-001',
) {
  // Model-aware cost monitoring based on Gemini API & Vertex AI pricing
  let costPerImage = 0.0004; // default for Gemini 2.0/2.5/3.1 flash models
  if (imageModel.includes('imagen')) {
    costPerImage = 0.0300; // Imagen 3.0 Standard
  } else if (imageModel.includes('pro')) {
    costPerImage = 0.0015; // Pro models
  }

  let costPerVideo = 0.2400; // default for preview/lite models (8s clip duration)
  if (videoModel.includes('3.1') || videoModel.includes('3.0')) {
    if (videoModel.includes('preview') || videoModel.includes('lite')) {
      costPerVideo = 0.4000; // Veo 3.1 Lite/Preview
    } else {
      costPerVideo = 2.8000; // Veo 3.1 Standard
    }
  } else if (videoModel.includes('2.0')) {
    if (videoModel.includes('preview')) {
      costPerVideo = 0.2400; // Veo 2.0 Preview
    } else {
      costPerVideo = 2.8000; // Veo 2.0 Standard
    }
  }

  const imageCost = imagesGenerated * costPerImage;
  const videoCost = videoGenerated ? costPerVideo : 0;
  const totalCost = imageCost + videoCost;

  logger.info(
    {
      jobId,
      imagesGenerated,
      videoGenerated,
      failed,
      imageModel,
      videoModel,
      estimatedCostUSD: totalCost.toFixed(4),
      imageCostUSD: imageCost.toFixed(4),
      videoCostUSD: videoCost.toFixed(4),
    },
    'Generation cost estimate',
  );

  return totalCost;
}

// ── Error telemetry (P5.4) ───────────────────────────────────────────────────
// Logs structured error events. In production this would forward to
// a monitoring service (e.g., Sentry, Datadog). For now, structured log
// output is picked up by any log aggregator.

export function logErrorEvent(
  context: string,
  err: Error | any,
  meta?: LogMeta,
) {
  logger.error(
    {
      context,
      err,
      errorType: err?.constructor?.name || 'Error',
      errorCode: err?.code,
      ...meta,
    },
    `Error in ${context}: ${err?.message || String(err)}`,
  );
}
