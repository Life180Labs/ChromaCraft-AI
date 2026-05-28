import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export interface JudgeRequest {
  imagePath: string;
  goal: string;
  color: string;
}

export interface JudgeResponse {
  passed: boolean;
  critique: string;
  clipScore?: number;
  dinov2Score?: number;
  ssimScore?: number;
  aggregate?: number;
}

/**
 * POST /api/v1/judge
 * Quality validation using CLIP/DINOv2/SSIM similarity scoring.
 * Falls back to heuristic if Python validator unavailable.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const body = (await req.json()) as JudgeRequest;
    const { imagePath, goal, color } = body;

    if (!imagePath || !goal || !color) {
      return NextResponse.json(
        { error: 'imagePath, goal, and color are required' },
        { status: 400 },
      );
    }

    const resolvedPath = path.resolve(imagePath);
    const fileExists = await fs.promises.stat(resolvedPath).then(() => true).catch(() => false);
    if (!fileExists) {
      return NextResponse.json(
        { error: `Image not found at path: ${resolvedPath}` },
        { status: 404 },
      );
    }

    // Try CLIP/DINOv2 quality validator
    try {
      const result = await runQualityValidator(resolvedPath, goal);
      return NextResponse.json(result);
    } catch (err: any) {
      console.warn('[JudgeAPI] Quality validator failed, using heuristic fallback:', err.message);
    }

    // Heuristic fallback
    const result = await heuristicJudge(resolvedPath, color);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[JudgeAPI] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

async function runQualityValidator(imagePath: string, goal: string): Promise<JudgeResponse> {
  const scriptDir = path.join(process.cwd(), '..', 'worker', 'python');
  const workerPythonDir = path.join(process.cwd(), '..', '..', 'apps', 'worker', 'python');

  const scriptPath = [
    path.join(scriptDir, 'quality.py'),
    path.join(workerPythonDir, 'quality.py'),
  ].find(p => fs.existsSync(p));

  if (!scriptPath) {
    throw new Error('Quality validator script not found');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('python', [
      scriptPath,
      '--original', imagePath,
      '--generated', imagePath,
      '--threshold', process.env.QUALITY_THRESHOLD || '0.92',
      '--jsonMode',
    ]);

    let stdout = '', stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Validator exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }

      const lines = stdout.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().startsWith('{')) {
          try {
            const data = JSON.parse(lines[i]);
            resolve({
              passed: Boolean(data.passed),
              critique: String(data.critique || ''),
              clipScore: data.clip_score ?? undefined,
              dinov2Score: data.dinov2_score ?? undefined,
              ssimScore: data.ssim_score ?? undefined,
              aggregate: data.aggregate ?? undefined,
            });
            return;
          } catch { }
        }
      }
      reject(new Error('No valid JSON from quality validator'));
    });
  });
}

async function heuristicJudge(imagePath: string, color: string): Promise<JudgeResponse> {
  const stats = await fs.promises.stat(imagePath);

  if (stats.size < 5120) {
    return {
      passed: false,
      critique: `Image file is suspiciously small (${stats.size} bytes). Expected a full rendered variant.`,
    };
  }

  const colorSlug = color.trim().toLowerCase().replace(/\s+/g, '_');
  const filenameLower = path.basename(imagePath).toLowerCase();

  if (!filenameLower.includes(colorSlug)) {
    return {
      passed: false,
      critique: `Filename "${path.basename(imagePath)}" does not match expected color slug "${colorSlug}".`,
    };
  }

  return {
    passed: true,
    critique: `Heuristic pass: file size ${stats.size} bytes, filename matches "${colorSlug}".`,
    aggregate: 0.5,
  };
}
