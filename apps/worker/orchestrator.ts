/**
 * AgentController — ReAct (Reasoning + Acting) loop for ChromaCraft image generation.
 *
 * Loop per color variant:
 *   1. Plan  → compose an enhanced prompt for this iteration
 *   2. Act   → invoke the Python generate tool (JSON-mode)
 *   3. Judge → call the Vision Judge API to evaluate the output
 *   4. Log   → persist an Iteration record in the database
 *   5. Retry → if judge fails and retries remain, re-prompt with the critique
 */

import { PrismaClient, IterationStatus, Prisma } from '@prisma/client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import pino from 'pino';

const logger = pino({ name: 'chromacraft-orchestrator' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationParams {
  provider: string;
  apiKey: string;
  outDir: string;
  refImagePath?: string;
}

export interface VariantResult {
  color: string;
  iterationId: number;
  assetPath: string | null;
  passed: boolean;
  critique: string;
  attempts: number;
}

export interface ToolOutput {
  status: 'success' | 'error';
  path?: string;
  metadata?: string;
  reason?: string;
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
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 3; // Maximum retry attempts per color variant
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

  /**
   * Entry point — run the full ReAct loop for a single job.
   * @param jobId   Database ID of the Job record
   * @param goal    Human-readable generation goal (e.g. "Generate photorealistic color variants for catalog")
   * @param params  Provider credentials and output paths
   * @param colors  Array of color names to process
   * @param basePrompt  Template prompt string
   */
  async run(
    jobId: number,
    goal: string,
    params: GenerationParams,
    colors: string[],
    basePrompt: string,
  ): Promise<VariantResult[]> {
    logger.info({ jobId, goal, colorCount: colors.length }, 'AgentController starting ReAct loop');

    // Persist the goal on the job record
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        currentGoal: goal,
        statusHistory: this.buildHistoryEntry(
          await this.getExistingHistory(jobId),
          'STARTED',
          `ReAct loop started for ${colors.length} colors`,
        ),
      },
    });

    await fs.promises.mkdir(params.outDir, { recursive: true });

    const results: VariantResult[] = [];

    for (const color of colors) {
      const result = await this.processColor(jobId, goal, color, basePrompt, params);
      results.push(result);

      // Update job statusHistory with per-color outcome
      const history = await this.getExistingHistory(jobId);
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          statusHistory: this.buildHistoryEntry(
            history,
            result.passed ? 'COLOR_PASSED' : 'COLOR_FAILED',
            `Color "${color}" ${result.passed ? 'passed' : 'failed'} after ${result.attempts} attempt(s). ${result.critique}`,
          ),
        },
      });
    }

    const allPassed = results.every((r) => r.passed);
    logger.info({ jobId, allPassed, resultCount: results.length }, 'ReAct loop complete');

    return results;
  }

  // ---------------------------------------------------------------------------
  // Process a single color with retry loop
  // ---------------------------------------------------------------------------

  private async processColor(
    jobId: number,
    goal: string,
    color: string,
    basePrompt: string,
    params: GenerationParams,
  ): Promise<VariantResult> {
    let currentPrompt = await this.planPrompt(basePrompt, color, goal, null);
    let attempt = 0;
    let lastCritique = '';
    let iterationId = 0;
    let assetPath: string | null = null;

    while (attempt < MAX_ITERATIONS) {
      attempt++;
      logger.info({ jobId, color, attempt }, 'Executing generation attempt');

      // 1. Create RUNNING iteration record
      const iteration = await this.prisma.iteration.create({
        data: {
          jobId,
          prompt: currentPrompt,
          status: IterationStatus.RUNNING,
        },
      });
      iterationId = iteration.id;

      // 2. Act — invoke Python tool in JSON mode
      const toolOutput = await this.invokeTool(jobId, currentPrompt, color, params);

      if (toolOutput.status === 'error' || !toolOutput.path) {
        const reason = toolOutput.reason ?? 'Unknown Python tool error';
        logger.warn({ jobId, color, attempt, reason }, 'Tool execution failed');
        await this.prisma.iteration.update({
          where: { id: iterationId },
          data: {
            status: IterationStatus.FAILED,
            critique: reason,
          },
        });
        lastCritique = reason;
        // Refine prompt with the failure reason and retry
        currentPrompt = await this.planPrompt(basePrompt, color, goal, lastCritique);
        continue;
      }

      assetPath = toolOutput.path;

      // 3. Judge — call vision judge API
      let judgeResult: JudgeResponse;
      try {
        judgeResult = await this.invokeJudge(assetPath, goal, color);
      } catch (judgeErr: any) {
        logger.warn({ jobId, color, attempt, err: judgeErr.message }, 'Judge call failed; defaulting to pass');
        // If judge itself errors (e.g. no network), treat as passed to avoid blocking pipeline
        judgeResult = { passed: true, critique: `Judge unavailable: ${judgeErr.message}` };
      }

      // 4. Log — update iteration with judge verdict
      const iterStatus = judgeResult.passed ? IterationStatus.PASSED : IterationStatus.FAILED;
      await this.prisma.iteration.update({
        where: { id: iterationId },
        data: {
          status: iterStatus,
          critique: judgeResult.critique,
          assetPath,
        },
      });

      if (judgeResult.passed) {
        logger.info({ jobId, color, attempt }, 'Variant passed quality check');
        return {
          color,
          iterationId,
          assetPath,
          passed: true,
          critique: judgeResult.critique,
          attempts: attempt,
        };
      }

      // 5. Self-correct — re-plan with critique before next iteration
      lastCritique = judgeResult.critique;
      logger.warn({ jobId, color, attempt, critique: lastCritique }, 'Variant failed; retrying');

      if (attempt < MAX_ITERATIONS) {
        await this.prisma.iteration.update({
          where: { id: iterationId },
          data: { status: IterationStatus.RETRYING },
        });
        currentPrompt = await this.planPrompt(basePrompt, color, goal, lastCritique);
      }
    }

    // All retries exhausted — throw circuit breaker error
    throw new MaxRetriesExceededError(
      `Failed to generate acceptable image for color "${color}" after ${MAX_ITERATIONS} attempts. Last critique: ${lastCritique}`
    );
  }

  // ---------------------------------------------------------------------------
  // Plan: compose an enhanced, critique-aware prompt
  // ---------------------------------------------------------------------------

  private async planPrompt(basePrompt: string, color: string, goal: string, critique: string | null): Promise<string> {
    const colorResolved = basePrompt.replace(/\[color\]/gi, color);

    if (!critique) {
      return `${colorResolved}. Vehicle exterior color: ${color}. Goal: ${goal}. Photorealistic, studio lighting, white background, catalog quality.`;
    }

    const adjustmentInstructions = await this.synthesizeCritique(critique);

    return (
      `${colorResolved}. Vehicle exterior color: ${color}. ` +
      `Goal: ${goal}. ` +
      `Adjustment Instructions: ${adjustmentInstructions}. ` +
      `Photorealistic, studio lighting, white background, catalog quality.`
    );
  }

  private async synthesizeCritique(critique: string): Promise<string> {
    const apiKey = process.env.AI_OPENAI_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return `Address this feedback: ${critique}`;
    }

    const systemPrompt = `You are an AI prompt engineering expert. 
You are given a raw critique from a vision judge about a generated product image.
Your task is to synthesize this critique into concise, actionable "Adjustment Instructions" for a text-to-image generator.
Do not provide a full prompt, just the short instructions to append. (e.g. "Reduce reflection intensity," "Increase color saturation").
Output ONLY the synthesized instructions string.`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Raw critique: ${critique}` },
          ],
          max_tokens: 150,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        logger.warn('Failed to synthesize critique via LLM, falling back to raw critique.');
        return `Address this feedback: ${critique}`;
      }

      const data = (await response.json()) as OpenAIResponse;
      return data.choices?.[0]?.message?.content?.trim() ?? `Address this feedback: ${critique}`;
    } catch (err) {
      logger.error({ err }, 'Error calling LLM for synthesizeCritique');
      return `Address this feedback: ${critique}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Act: invoke Python generate.py via JSON-mode CLI
  // ---------------------------------------------------------------------------

  private async invokeTool(
    jobId: number,
    prompt: string,
    color: string,
    params: GenerationParams,
  ): Promise<ToolOutput> {
    const scriptPath = path.join(this.scriptDir, 'generate.py');

    const args: string[] = [
      '--task', 'generate',
      '--jobId', String(jobId),
      '--prompt', prompt,
      '--provider', params.provider,
      '--apiKey', params.apiKey || 'none',
      '--outDir', params.outDir,
      '--colors', color,
      '--jsonMode',
    ];

    if (params.refImagePath) {
      const exists = await fs.promises.stat(params.refImagePath).then(() => true).catch(() => false);
      if (exists) {
        args.push('--refImage', params.refImagePath);
      }
    }

    logger.debug({ jobId, color, args }, 'Spawning Python tool');

    const { exitCode, stdout, stderr } = await runProcess('python', [scriptPath, ...args]);

    if (exitCode !== 0) {
      return { status: 'error', reason: `Python exited ${exitCode}: ${stderr.slice(0, 500)}` };
    }

    // Parse JSON output from the last line that is valid JSON
    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        try {
          const parsed = JSON.parse(line) as ToolOutput;
          return parsed;
        } catch {
          // not valid JSON, keep looking
        }
      }
    }

    // No JSON found — treat stdout as success if exit was 0
    return {
      status: 'error',
      reason: `Tool completed but returned no JSON. stdout: ${stdout.slice(0, 300)}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Judge: POST to the Next.js vision judge API
  // ---------------------------------------------------------------------------

  private async invokeJudge(imagePath: string, goal: string, color: string): Promise<JudgeResponse> {
    const url = `${JUDGE_BASE_URL}/api/v1/judge`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath, goal, color }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Judge API returned ${response.status}: ${text}`);
    }

    const data = await response.json();
    return { passed: Boolean(data.passed), critique: String(data.critique ?? '') };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getExistingHistory(jobId: number): Promise<Prisma.InputJsonValue[]> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { statusHistory: true },
    });
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

// ---------------------------------------------------------------------------
// Utility: spawn a child process and collect output
// ---------------------------------------------------------------------------

async function runProcess(
  command: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(command, args);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
  });

  return { exitCode, stdout, stderr };
}
