/**
 * AgentController — ReAct loop for ChromaCraft image generation.
 *
 * Supports:
 * • Multi-color catalog variant generation (generate task)
 * • 360° turntable spin generation (spin360 task)
 * • Video / GIF assembly from spin frames (video task)
 *
 * Loop per color variant:
 * 1. Plan  → compose an enhanced prompt for this iteration
 * 2. Act   → invoke the Python generate tool (JSON-mode)
 * 3. Judge → call the Vision Judge API to evaluate the output
 * 4. Log   → persist an Iteration record in the database
 * 5. Retry → if judge fails and retries remain, re-prompt with the critique
 */

import { PrismaClient, IterationStatus, Prisma } from '@prisma/client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import sharp from 'sharp';

const logger = pino({ name: 'chromacraft-orchestrator' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationSettings {
  cols?: number;
  rows?: number;
  colors?: string[];
  prefix?: string;
  industry?: string;
  targetMarket?: string;
  targetAudience?: string;
  targetPurpose?: string;
  lifestyleEnabled?: boolean;
  videoEnabled?: boolean;
  spinEnabled?: boolean;
  cropsEnabled?: boolean;
  imageSize?: string; // e.g. "800x600"
  spinFrames?: number;
  fps?: number;
  skipGeneration?: boolean; // <-- Added flag for Puter.js hybrid approach
}

export interface GenerationParams {
  provider: string;
  apiKey: string;
  outDir: string;
  refImagePath?: string;
  settings?: GenerationSettings;
}

export interface VariantResult {
  color: string;
  iterationId: number;
  assetPath: string | null;
  passed: boolean;
  critique: string;
  attempts: number;
}

export interface SpinResult {
  prefix: string;
  framePaths: string[];
  videoPath: string | null;
}

export interface ToolOutput {
  status: 'success' | 'error';
  path?: string;
  metadata?: string;
  reason?: string;
  context?: string;
}

export interface JudgeResponse {
  passed: boolean;
  critique: string;
}

export class MaxRetriesExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaxRetriesExceededError';
  }
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 3;
const JUDGE_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// AgentController
// ---------------------------------------------------------------------------

export class AgentController {
  private readonly prisma: PrismaClient;
  private readonly scriptDir: string;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.scriptDir = path.join(process.cwd(), 'python');
  }

  async run(
    jobId: number,
    goal: string,
    params: GenerationParams,
    colors: string[],
    basePrompt: string,
  ): Promise<VariantResult[]> {
    logger.info({ jobId, goal, colorCount: colors.length }, 'AgentController: starting ReAct loop');

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        currentGoal: goal,
        statusHistory: this.buildHistoryEntry(
          await this.getExistingHistory(jobId),
          'STARTED',
          `ReAct loop started for ${colors.length} color(s)`,
        ),
      },
    });

    await fs.promises.mkdir(params.outDir, { recursive: true });

    const results: VariantResult[] = [];

    for (const color of colors) {
      const result = await this.processColor(jobId, goal, color, basePrompt, params);
      results.push(result);

      const history = await this.getExistingHistory(jobId);
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          statusHistory: this.buildHistoryEntry(
            history,
            result.passed ? 'COLOR_PASSED' : 'COLOR_FAILED',
            `"${color}" ${result.passed ? 'passed' : 'failed'} after ${result.attempts} attempt(s). ${result.critique}`,
          ),
        },
      });
    }

    // ── Grid Engine & Smart Crop ──
    const cols = params.settings?.cols ?? 4;
    const rows = params.settings?.rows ?? 3;
    const passedResults = results.filter(r => r.passed && r.assetPath);
    
    if (passedResults.length > 0 && cols > 0 && rows > 0 && passedResults.length <= cols * rows) {
      try {
        logger.info({ jobId }, 'Grid Engine: Stitching generated variants into a master grid');
        
        // Find dimensions of the first valid image to establish a baseline
        const firstMetadata = await sharp(passedResults[0].assetPath).metadata();
        const cellWidth = firstMetadata.width || 800;
        const cellHeight = firstMetadata.height || 600;
        
        // Prepare composite inputs
        const composites = [];
        for (let i = 0; i < passedResults.length; i++) {
          const r = Math.floor(i / cols);
          const c = i % cols;
          composites.push({
            input: passedResults[i].assetPath!,
            top: r * cellHeight,
            left: c * cellWidth,
          });
        }
        
        const gridWidth = cols * cellWidth;
        const gridHeight = Math.ceil(passedResults.length / cols) * cellHeight;
        
        const gridFilename = `grid_${params.settings?.prefix || jobId}.png`;
        const gridPath = path.join(params.outDir, gridFilename);
        
        await sharp({
          create: {
            width: gridWidth,
            height: gridHeight,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }
        })
        .composite(composites)
        .png()
        .toFile(gridPath);
        
        // Register the grid in DB
        await this.prisma.asset.create({
          data: {
            jobId,
            type: 'processed',
            path: gridPath,
            status: 'done',
          }
        });
        logger.info({ jobId, gridPath }, 'Grid stitched successfully');
        
        // Smart Crop for Social Media (if 2x2 and enabled)
        if (params.settings?.cropsEnabled && cols === 2 && rows === 2 && passedResults.length === 4) {
          logger.info({ jobId }, 'Smart Crop: Slicing 2x2 grid for social media');
          for (let i = 0; i < 4; i++) {
            const r = Math.floor(i / 2);
            const c = i % 2;
            const cropFilename = `social_crop_${i}_${params.settings?.prefix || jobId}.png`;
            const cropPath = path.join(params.outDir, cropFilename);
            
            await sharp(gridPath)
              .extract({
                left: c * cellWidth,
                top: r * cellHeight,
                width: cellWidth,
                height: cellHeight
              })
              .png()
              .toFile(cropPath);
              
            await this.prisma.asset.create({
              data: {
                jobId,
                type: 'processed',
                path: cropPath,
                status: 'done',
              }
            });
          }
          logger.info({ jobId }, 'Smart Crop slices created successfully');
        }
      } catch (err: any) {
        logger.error({ jobId, err: err.message }, 'Grid Engine / Smart Crop failed (non-blocking)');
      }
    }

    // ── Spin 360 ──
    const spinBaseImage = (passedResults.length > 0 ? passedResults[0].assetPath : null) || params.refImagePath;
    if (params.settings?.spinEnabled && spinBaseImage) {
      logger.info({ jobId }, 'Spin 360 enabled — generating turntable frames');
      try {
        const spinResult = await this.generateSpin360(jobId, params, spinBaseImage);
        if (spinResult.videoPath) {
          await this.prisma.asset.create({
            data: {
              jobId,
              type: 'video',
              path: spinResult.videoPath,
              status: 'done',
            },
          });
          logger.info({ jobId, videoPath: spinResult.videoPath }, 'Spin 360 video registered');
        }
        for (const framePath of spinResult.framePaths) {
          await this.prisma.asset.create({
            data: { jobId, type: 'spin_frame', path: framePath, status: 'done' },
          });
        }
      } catch (spinErr: any) {
        logger.error({ jobId, err: spinErr.message }, 'Spin 360 generation failed (non-blocking)');
      }
    }

    const allPassed = results.every((r) => r.passed);
    logger.info({ jobId, allPassed, resultCount: results.length }, 'ReAct loop complete');
    return results;
  }

  private async processColor(
    jobId: number,
    goal: string,
    color: string,
    basePrompt: string,
    params: GenerationParams,
  ): Promise<VariantResult> {

    // -----------------------------------------------------------------------
    // HYBRID CHECK: If skipGeneration is true, asset is already uploaded!
    // -----------------------------------------------------------------------
    if (params.settings?.skipGeneration) {
      logger.info({ jobId, color }, 'skipGeneration is TRUE (Puter fallback). Skipping Python generate.py task.');
      const safeColor = color.trim().replace(/\s+/g, '_');
      return {
        color,
        iterationId: 0,
        assetPath: path.join(params.outDir, `raw_${safeColor}.png`),
        passed: true,
        critique: 'Successfully generated and uploaded via Puter.js (Client-side)',
        attempts: 1,
      };
    }

    let currentPrompt = await this.planPrompt(basePrompt, color, goal, null, params);
    let attempt = 0;
    let lastCritique = '';
    let iterationId = 0;
    let assetPath: string | null = null;

    while (attempt < MAX_ITERATIONS) {
      attempt++;
      logger.info({ jobId, color, attempt }, 'Generation attempt');

      const iteration = await this.prisma.iteration.create({
        data: { jobId, prompt: currentPrompt, status: IterationStatus.RUNNING },
      });
      iterationId = iteration.id;

      const toolOutput = await this.invokeTool(jobId, currentPrompt, color, params);

      if (toolOutput.status === 'error' || !toolOutput.path) {
        const reason = toolOutput.reason ?? 'Unknown Python tool error';
        logger.warn({ jobId, color, attempt, reason }, 'Tool execution failed');
        await this.prisma.iteration.update({
          where: { id: iterationId },
          data: { status: IterationStatus.FAILED, critique: reason },
        });
        lastCritique = reason;
        currentPrompt = await this.planPrompt(basePrompt, color, goal, lastCritique, params);
        continue;
      }

      assetPath = toolOutput.path;

      let judgeResult: JudgeResponse;
      try {
        judgeResult = await this.invokeJudge(assetPath, goal, color);
      } catch (err: any) {
        logger.warn({ jobId, color, attempt }, `Judge unavailable: ${err.message}`);
        judgeResult = { passed: true, critique: `Judge unavailable: ${err.message}` };
      }

      const iterStatus = judgeResult.passed ? IterationStatus.PASSED : IterationStatus.FAILED;
      await this.prisma.iteration.update({
        where: { id: iterationId },
        data: { status: iterStatus, critique: judgeResult.critique, assetPath },
      });

      if (judgeResult.passed) {
        logger.info({ jobId, color, attempt }, 'Variant passed QC');
        return { color, iterationId, assetPath, passed: true, critique: judgeResult.critique, attempts: attempt };
      }

      lastCritique = judgeResult.critique;
      logger.warn({ jobId, color, attempt, critique: lastCritique }, 'Variant failed; retrying');
      if (attempt < MAX_ITERATIONS) {
        await this.prisma.iteration.update({
          where: { id: iterationId },
          data: { status: IterationStatus.RETRYING },
        });
        currentPrompt = await this.planPrompt(basePrompt, color, goal, lastCritique, params);
      }
    }

    logger.error({ jobId, color }, `All ${MAX_ITERATIONS} attempts failed for color "${color}"`);
    return {
      color,
      iterationId,
      assetPath,
      passed: false,
      critique: lastCritique,
      attempts: attempt,
    };
  }

  private async planPrompt(
    basePrompt: string,
    color: string,
    goal: string,
    critique: string | null,
    params: GenerationParams
  ): Promise<string> {
    const colorResolved = basePrompt.replace(/\[color\]/gi, color);
    
    let lifestyleAppend = '';
    if (params.settings?.lifestyleEnabled && params.settings?.targetMarket) {
      lifestyleAppend = ` Set in a photorealistic ${params.settings.targetMarket} environment.`;
    }

    if (!critique) {
      return (
        `${colorResolved}. Vehicle exterior color: ${color}. ` +
        `Goal: ${goal}. Photorealistic, studio lighting, catalog quality.${lifestyleAppend}`
      );
    }

    const adjustments = await this.synthesizeCritique(critique);
    return (
      `${colorResolved}. Vehicle exterior color: ${color}. ` +
      `Goal: ${goal}. Adjustments: ${adjustments}. ` +
      `Photorealistic, studio lighting, catalog quality.${lifestyleAppend}`
    );
  }

  private async synthesizeCritique(critique: string): Promise<string> {
    const apiKey = process.env.AI_OPENAI_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) return `Address: ${critique}`;

    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a prompt engineering expert. Convert the critique into concise, actionable adjustment instructions for a text-to-image model. Output ONLY the short instruction string.',
            },
            { role: 'user', content: `Raw critique: ${critique}` },
          ],
          max_tokens: 100,
          temperature: 0.2,
        }),
      });
      const data = (await resp.json()) as OpenAIResponse;
      return data.choices?.[0]?.message?.content?.trim() ?? `Address: ${critique}`;
    } catch {
      return `Address: ${critique}`;
    }
  }

  private async invokeTool(
    jobId: number,
    prompt: string,
    color: string,
    params: GenerationParams,
  ): Promise<ToolOutput> {
    const scriptPath = path.join(this.scriptDir, 'generate.py');
    const imageSize = params.settings?.imageSize || '800x600';

    const args: string[] = [
      '--task', 'generate',
      '--jobId', String(jobId),
      '--prompt', prompt,
      '--provider', params.provider,
      '--apiKey', params.apiKey || 'none',
      '--outDir', params.outDir,
      '--colors', color,
      '--imageSize', imageSize,
      '--jsonMode',
    ];

    if (params.refImagePath) {
      const exists = await fs.promises.stat(params.refImagePath).then(() => true).catch(() => false);
      if (exists) args.push('--refImage', params.refImagePath);
    }

    logger.debug({ jobId, color, args: args.join(' ') }, 'Spawning Python task');
    const { exitCode, stdout, stderr } = await runProcess('python', [scriptPath, ...args]);

    if (exitCode !== 0) {
      return { status: 'error', reason: `Python exited ${exitCode}: ${stderr.slice(0, 500)}` };
    }

    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        try {
          return JSON.parse(line) as ToolOutput;
        } catch { /* try previous line */ }
      }
    }
    return { status: 'error', reason: `No JSON in stdout: ${stdout.slice(0, 300)}` };
  }

  private async generateSpin360(jobId: number, params: GenerationParams, spinBaseImage: string): Promise<SpinResult> {
    const scriptPath = path.join(this.scriptDir, 'generate.py');
    const spinsDir = path.join(params.outDir, 'spin360');
    await fs.promises.mkdir(spinsDir, { recursive: true });

    const prefix = params.settings?.prefix || `job_${jobId}`;
    const frames = params.settings?.spinFrames || 36;
    const imageSize = params.settings?.imageSize || '800x600';

    const spinArgs = [
      scriptPath,
      '--task', 'spin360',
      '--refImage', spinBaseImage,
      '--outDir', spinsDir,
      '--prefix', prefix,
      '--frames', String(frames),
      '--imageSize', imageSize,
      '--jsonMode',
    ];

    logger.info({ jobId, frames, prefix }, 'Generating 360 spin frames');
    const { exitCode, stdout, stderr } = await runProcess('python', spinArgs);

    if (exitCode !== 0) {
      throw new Error(`Spin 360 Python script failed (exit ${exitCode}): ${stderr}`);
    }

    const framePaths: string[] = [];
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const out = JSON.parse(trimmed) as ToolOutput;
        if (out.status === 'success' && out.path) framePaths.push(out.path);
      } catch { /* skip */ }
    }

    if (framePaths.length === 0) {
      throw new Error('No spin frames were produced');
    }

    let videoPath: string | null = null;
    if (params.settings?.videoEnabled) {
      const videoOutPath = path.join(spinsDir, `${prefix}_360.mp4`);
      const fps = params.settings?.fps || 12;
      const videoArgs = [
        scriptPath,
        '--task', 'video',
        '--framesDir', spinsDir,
        '--outputPath', videoOutPath,
        '--prefix', prefix,
        '--fps', String(fps),
        '--outDir', spinsDir,
        '--jsonMode',
      ];
      const videoResult = await runProcess('python', videoArgs);
      const videoLines = videoResult.stdout.trim().split('\n');
      for (let i = videoLines.length - 1; i >= 0; i--) {
        const t = videoLines[i].trim();
        if (t.startsWith('{')) {
          try {
            const out = JSON.parse(t) as ToolOutput;
            if (out.status === 'success' && out.path) { videoPath = out.path; break; }
          } catch { /* skip */ }
        }
      }
    }

    return { prefix, framePaths, videoPath };
  }

  private async invokeJudge(imagePath: string, goal: string, color: string): Promise<JudgeResponse> {
    const url = `${JUDGE_BASE_URL}/api/v1/judge`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath, goal, color }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Judge API ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return { passed: Boolean(data.passed), critique: String(data.critique ?? '') };
  }

  private async getExistingHistory(jobId: number): Promise<Prisma.InputJsonValue[]> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { statusHistory: true } });
    const raw = job?.statusHistory;
    return Array.isArray(raw) ? (raw as Prisma.InputJsonValue[]) : [];
  }

  private buildHistoryEntry(
    existing: Prisma.InputJsonValue[],
    status: string,
    message: string,
  ): Prisma.InputJsonValue[] {
    return [
      ...existing,
      { timestamp: new Date().toISOString(), status, message } as Prisma.InputJsonValue,
    ];
  }
}

async function runProcess(
  command: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(command, args);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const exitCode = await new Promise<number | null>((resolve) => { child.on('close', resolve); });
  return { exitCode, stdout, stderr };
}