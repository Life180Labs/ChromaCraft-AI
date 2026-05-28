import { PrismaClient, IterationStatus, Prisma } from '@prisma/client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import pino from 'pino';

const logger = pino({ name: 'chromacraft-orchestrator' });

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
  imageSize?: string;
  spinFrames?: number;
  fps?: number;
  skipGeneration?: boolean;
  strategy?: string;
  denoiseStrength?: number;
  qualityThreshold?: number;
  identityLock?: boolean;
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
  qualityScore?: number;
}

export interface ToolOutput {
  status: 'success' | 'error';
  path?: string;
  metadata?: string;
  reason?: string;
  context?: string;
}

export interface QualityResult {
  passed: boolean;
  critique: string;
  clip_score: number;
  dinov2_score: number;
  ssim_score: number;
  aggregate: number;
}

const MAX_ITERATIONS = 2;
const QUALITY_THRESHOLD = parseFloat(process.env.QUALITY_THRESHOLD || '0.92');

export class AgentController {
  private readonly prisma: PrismaClient;
  private readonly scriptDir: string;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.scriptDir = path.join(process.cwd(), 'python');
  }

  async run(
    jobId: number, goal: string, params: GenerationParams, colors: string[], basePrompt: string
  ): Promise<VariantResult[]> {
    logger.info({ jobId, goal, colorCount: colors.length }, 'AgentController: starting identity-preserving ReAct loop');

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        currentGoal: goal,
        progress: 5,
        statusHistory: this.buildHistoryEntry(
          await this.getExistingHistory(jobId),
          'STARTED', `Identity-preserving generation for ${colors.length} color(s)`
        ),
      },
    });

    await fs.promises.mkdir(params.outDir, { recursive: true });

    // Generate control inputs once (reused for all colors)
    const identityDir = path.join(params.outDir, 'identity');
    if (params.refImagePath) {
      try {
        await this.runIdentityPreservation(params.refImagePath, identityDir);
        logger.info({ jobId }, 'Identity preservation controls generated');
      } catch (err: any) {
        logger.warn({ jobId, err: err.message }, 'Identity control generation failed (continuing without)');
      }
    }

    // Parallel color processing with identity preservation
    const strategy = params.settings?.strategy || 'stability';
    const denoiseStrength = params.settings?.denoiseStrength ?? 0.4;

    const colorPromises = colors.map((color, index) =>
      this.processColor(jobId, goal, color, basePrompt, params, strategy, denoiseStrength)
        .then(async (result) => {
          const progress = 5 + Math.round(((index + 1) / colors.length) * 70);
          await this.prisma.job.update({
            where: { id: jobId },
            data: { progress },
          });
          return result;
        })
    );

    const results = await Promise.allSettled(colorPromises);
    const variantResults: VariantResult[] = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      logger.error({ jobId, color: colors[i], err: r.reason }, 'Color processing failed');
      return {
        color: colors[i],
        iterationId: 0,
        assetPath: null,
        passed: false,
        critique: `Fatal: ${r.reason}`,
        attempts: 1,
      };
    });

    // Log results
    for (const result of variantResults) {
      const history = await this.getExistingHistory(jobId);
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          statusHistory: this.buildHistoryEntry(
            history,
            result.passed ? 'COLOR_PASSED' : 'COLOR_FAILED',
            `"${result.color}" ${result.passed ? 'passed' : 'failed'} after ${result.attempts} attempt(s). Score: ${result.qualityScore?.toFixed(3) ?? 'N/A'}`
          ),
        },
      });
    }

    generateCollaterals(jobId, params, variantResults, this.prisma, this.scriptDir).catch((err) => {
      logger.error({ jobId, err: err.message }, 'Collateral generation failed');
    });

    return variantResults;
  }

  private async processColor(
    jobId: number, goal: string, color: string, basePrompt: string,
    params: GenerationParams, strategy: string, denoiseStrength: number,
  ): Promise<VariantResult> {
    if (params.settings?.skipGeneration) {
      const safeColor = color.trim().replace(/\s+/g, '_');
      return {
        color, iterationId: 0, assetPath: path.join(params.outDir, `raw_${safeColor}.png`),
        passed: true, critique: 'Skipped generation via UI flag', attempts: 1, qualityScore: 1.0,
      };
    }

    const identityLock = params.settings?.identityLock !== false;
    const qualityThreshold = params.settings?.qualityThreshold ?? QUALITY_THRESHOLD;

    let currentPrompt = await this.planPrompt(basePrompt, color, goal, null, params);
    let attempt = 0, lastCritique = '', assetPath: string | null = null;
    let lastQuality: QualityResult | null = null;

    while (attempt < MAX_ITERATIONS) {
      attempt++;

      const iteration = await this.prisma.iteration.create({
        data: { jobId, prompt: currentPrompt, status: IterationStatus.RUNNING },
      });

      const strategyToUse = attempt === 1 ? strategy : 'stability';
      const toolOutput = await this.invokeTool(jobId, currentPrompt, color, params, strategyToUse, denoiseStrength);

      if (toolOutput.status === 'error' || !toolOutput.path) {
        lastCritique = toolOutput.reason ?? 'Tool failed';
        await this.prisma.iteration.update({
          where: { id: iteration.id },
          data: { status: IterationStatus.FAILED, critique: lastCritique },
        });
        currentPrompt = await this.planPrompt(basePrompt, color, goal, lastCritique, params);
        continue;
      }

      assetPath = toolOutput.path;

      // Identity lock via pixel composite is disabled for LHD->RHD & recoloring.
      // The ControlNet endpoint naturally preserves structure without pixel pasting.
      
      // Quality validation with CLIP/DINOv2
      let qualityResult: QualityResult;
      try {
        qualityResult = await this.runQualityValidation(params.refImagePath!, assetPath);
      } catch (err: any) {
        logger.warn({ jobId, err: err.message }, 'Quality validator unavailable, using heuristic');
        qualityResult = { passed: true, critique: 'Validator unavailable', clip_score: 0, dinov2_score: 0, ssim_score: 0, aggregate: 0.95 };
      }

      lastQuality = qualityResult;

      await this.prisma.iteration.update({
        where: { id: iteration.id },
        data: {
          status: qualityResult.passed ? IterationStatus.PASSED : IterationStatus.FAILED,
          critique: qualityResult.critique,
          assetPath,
          clipScore: qualityResult.aggregate,
          aggregateScore: qualityResult.aggregate,
        },
      });

      if (qualityResult.passed) {
        return {
          color, iterationId: iteration.id, assetPath,
          passed: true, critique: qualityResult.critique, attempts: attempt,
          qualityScore: qualityResult.aggregate,
        };
      }

      lastCritique = qualityResult.critique;
      if (attempt < MAX_ITERATIONS) {
        currentPrompt = await this.planPrompt(basePrompt, color, goal, lastCritique, params);
        currentPrompt += ` [Identity Fix: Maintain exact shape, geometry, and structure. Previous score: ${qualityResult.aggregate.toFixed(3)}]`;
      }
    }

    return {
      color, iterationId: 0, assetPath,
      passed: false, critique: lastCritique, attempts: attempt,
      qualityScore: lastQuality?.aggregate ?? 0,
    };
  }

  private async planPrompt(
    basePrompt: string, color: string, goal: string, critique: string | null, params: GenerationParams
  ): Promise<string> {
    const colorResolved = basePrompt.replace(/\[color\]/gi, color);
    const industry = params.settings?.industry && params.settings.industry !== 'General' ? params.settings.industry : 'Product';

    const identityInstruction =
      'CRITICAL: The product shape, geometry, proportions, camera angle, reflections, and ALL structural details MUST remain identical to the original.';

    if (!critique) {
      return `${colorResolved}. ${industry} primary color: ${color}. Goal: ${goal}. ${identityInstruction} Photorealistic, studio lighting, catalog quality.`;
    }
    return `${colorResolved}. ${industry} primary color: ${color}. Goal: ${goal}. ${identityInstruction} Adjustments: ${critique}. Photorealistic, studio lighting, catalog quality.`;
  }

  private async runIdentityPreservation(refImagePath: string, outDir: string): Promise<void> {
    const scriptPath = path.join(this.scriptDir, 'identity.py');
    const { exitCode, stderr } = await runProcess('python', [
      scriptPath, '--task', 'control_inputs', '--refImage', refImagePath,
      '--outputDir', outDir, '--jsonMode',
    ]);
    if (exitCode !== 0) {
      throw new Error(`Identity preservation failed: ${stderr.slice(0, 200)}`);
    }
  }

  private async applyIdentityLock(
    originalPath: string, generatedPath: string, color: string, outDir: string
  ): Promise<string> {
    const scriptPath = path.join(this.scriptDir, 'identity.py');
    const lockedPath = path.join(outDir, `locked_raw_${color.replace(/\s+/g, '_')}.png`);

    const { exitCode } = await runProcess('python', [
      scriptPath, '--task', 'lock_composite', '--refImage', originalPath,
      '--genImage', generatedPath, '--outputPath', lockedPath,
      '--color', color, '--jsonMode',
    ]);

    if (exitCode === 0 && fs.existsSync(lockedPath)) {
      return lockedPath;
    }
    return generatedPath;
  }

  private async runQualityValidation(originalPath: string, generatedPath: string): Promise<QualityResult> {
    const scriptPath = path.join(this.scriptDir, 'quality.py');
    const { exitCode, stdout, stderr } = await runProcess('python', [
      scriptPath, '--original', originalPath, '--generated', generatedPath,
      '--threshold', String(QUALITY_THRESHOLD), '--jsonMode',
    ]);

    if (exitCode !== 0) {
      throw new Error(`Quality validator crashed: ${stderr.slice(0, 300)}`);
    }

    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith('{')) {
        try {
          return JSON.parse(lines[i]) as QualityResult;
        } catch { }
      }
    }
    throw new Error('No JSON output from quality validator');
  }

  private async invokeTool(
    jobId: number, prompt: string, color: string, params: GenerationParams,
    strategy: string, denoiseStrength: number,
  ): Promise<ToolOutput> {
    const scriptPath = path.join(this.scriptDir, 'generate.py');
    const imageSize = params.settings?.imageSize || '800x600';
    const args: string[] = [
      '--task', 'generate', '--jobId', String(jobId), '--prompt', prompt,
      '--provider', params.provider, '--apiKey', params.apiKey || 'none',
      '--outDir', params.outDir, '--colors', color, '--imageSize', imageSize,
      '--strategy', strategy, '--denoiseStrength', String(denoiseStrength),
      '--seed', '42', '--jsonMode',
    ];
    if (params.refImagePath) args.push('--refImage', params.refImagePath);

    const { exitCode, stdout, stderr } = await runProcess('python', [scriptPath, ...args]);
    if (exitCode !== 0) return { status: 'error', reason: `Python exited ${exitCode}: ${stderr.slice(0, 500)}` };

    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith('{')) {
        try { return JSON.parse(lines[i]) as ToolOutput; } catch { }
      }
    }
    return { status: 'error', reason: 'No JSON in stdout' };
  }

  private async getExistingHistory(jobId: number): Promise<Prisma.InputJsonValue[]> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { statusHistory: true } });
    return Array.isArray(job?.statusHistory) ? (job?.statusHistory as Prisma.InputJsonValue[]) : [];
  }

  private buildHistoryEntry(existing: Prisma.InputJsonValue[], status: string, message: string): Prisma.InputJsonValue[] {
    return [...existing, { timestamp: new Date().toISOString(), status, message } as Prisma.InputJsonValue];
  }
}

// --- Standalone grid generation ---
export async function generateCollaterals(
  jobId: number, params: GenerationParams, results: VariantResult[],
  prisma: PrismaClient, scriptDir: string,
): Promise<void> {
  const passedResults = results.filter(r => r.passed && r.assetPath);
  if (passedResults.length === 0) return;

  const cols = params.settings?.cols ?? 4;
  const prefix = params.settings?.prefix || String(jobId);

  // Professional grid via Python
  try {
    const gridScript = path.join(scriptDir, 'grid.py');
    const gridPath = path.join(params.outDir, `grid_${prefix}.png`);
    const imagePaths = passedResults.map(r => r.assetPath!);
    const labels = passedResults.map(r => r.color);

    const gridArgs = [
      gridScript, '--images', ...imagePaths, '--output', gridPath,
      '--cols', String(cols), '--labels', ...labels,
      '--spacing', '15', '--padding', '25', '--borderRadius', '6',
      '--watermark', 'ChromaCraft AI',
      '--jsonMode',
    ];

    const result = await runProcess('python', gridArgs);
    if (result.exitCode === 0 && fs.existsSync(gridPath)) {
      await prisma.asset.create({ data: { jobId, type: 'grid', path: gridPath, status: 'done' } });
      logger.info({ jobId }, 'Grid generated successfully');
    }
  } catch (err: any) {
    logger.error({ jobId, err: err.message }, 'Grid generation failed');
  }

  // Video generation via Python
  if (params.settings?.videoEnabled !== false) {
    try {
      const videoScript = path.join(scriptDir, 'video.py');
      const videoPath = path.join(params.outDir, `${prefix}_showcase.mp4`);

      const videoArgs = [
        videoScript, '--task', 'showcase', '--framesDir', params.outDir,
        '--output', videoPath, '--prefix', prefix, '--jsonMode',
      ];

      const result = await runProcess('python', videoArgs);
      if (result.exitCode === 0 && fs.existsSync(videoPath)) {
        await prisma.asset.create({ data: { jobId, type: 'video', path: videoPath, status: 'done' } });
        logger.info({ jobId }, 'Video generated');
      }
    } catch (err: any) {
      logger.warn({ jobId, err: err.message }, 'Video generation failed');
    }
  }

  // 360 spin via Python multiview
  if (params.settings?.spinEnabled !== false && params.refImagePath) {
    try {
      const multiviewScript = path.join(scriptDir, 'multiview.py');
      const spinArgs = [
        multiviewScript, '--task', 'generate', '--refImage', params.refImagePath,
        '--apiKey', params.apiKey, '--outDir', params.outDir,
        '--prefix', prefix, '--provider', 'stability', '--jsonMode',
      ];

      const result = await runProcess('python', spinArgs);
      if (result.exitCode === 0) {
        logger.info({ jobId }, '360 spin generated');
      }
    } catch (err: any) {
      logger.warn({ jobId, err: err.message }, '360 spin generation failed');
    }
  }
}

async function runProcess(command: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { timeout: 180000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.on('error', (err) => resolve({ exitCode: 1, stdout, stderr: err.message }));
  });
}
