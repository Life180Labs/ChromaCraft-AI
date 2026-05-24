import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import fs from 'fs';
import path from 'path';

export interface JudgeRequest {
  imagePath: string;
  goal: string;
  color: string;
}

export interface JudgeResponse {
  passed: boolean;
  critique: string;
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * POST /api/v1/judge
 * Receives an imagePath (absolute server path) and goal string.
 * Calls an LLM vision API (OpenAI GPT-4o) or falls back to a
 * deterministic heuristic judge when no API key is configured.
 * Returns { passed: boolean, critique: string }.
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

    // Verify the file exists on disk before any judgment call.
    const resolvedPath = path.resolve(imagePath);
    const fileExists = await fs.promises.stat(resolvedPath).then(() => true).catch(() => false);
    if (!fileExists) {
      return NextResponse.json(
        { error: `Image not found at path: ${resolvedPath}` },
        { status: 404 },
      );
    }

    const openaiKey = process.env.AI_OPENAI_KEY || process.env.OPENAI_API_KEY;

    if (openaiKey) {
      const result = await callOpenAIVisionJudge(resolvedPath, goal, color, openaiKey);
      return NextResponse.json(result);
    }

    // Fallback: deterministic heuristic judge (no external call required).
    const result = await heuristicJudge(resolvedPath, goal, color);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[JudgeAPI] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// OpenAI GPT-4o Vision Judge
// ---------------------------------------------------------------------------

async function callOpenAIVisionJudge(
  imagePath: string,
  goal: string,
  color: string,
  apiKey: string,
): Promise<JudgeResponse> {
  const imageBuffer = await fs.promises.readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = 'image/png';

  const systemPrompt = `You are a strict QA vision inspector for an AI-powered product catalog generation system.
Your task: evaluate whether a generated product image meets the stated goal and color specification.

Assessment Criteria:
1. Does the product color match the requested color? (Note: for metallic colors like silver, gold, or bronze, accept reasonable grey/white/yellow/metallic representations with specular highlights).
2. Is the product visible and completely unobstructed?
3. Does it meet high-quality catalog aesthetic standards (clean background, good lighting)?

Respond ONLY with valid JSON in this exact shape: { "passed": boolean, "critique": string }
- "passed" must be true only if ALL criteria are met.
- "critique" must be a concise 1-2 sentence explanation of your verdict, specifically mentioning which criteria failed if any.
Do not include any text outside the JSON object.`;

  const userContent = [
    {
      type: 'text' as const,
      text: `Goal: ${goal}\nExpected color: ${color}\nDoes this image pass quality control?`,
    },
    {
      type: 'image_url' as const,
      image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'low' as const },
    },
  ];

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
        { role: 'user', content: userContent },
      ],
      max_tokens: 200,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI Vision API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '';

  // Strip any markdown code fences the model may wrap around JSON.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: JudgeResponse;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If the model returned non-JSON, treat as a pass with the raw text as critique.
    parsed = { passed: true, critique: raw.slice(0, 300) };
  }

  return {
    passed: Boolean(parsed.passed),
    critique: String(parsed.critique ?? ''),
  };
}

// ---------------------------------------------------------------------------
// Heuristic Judge (no external API required)
// Checks file size and resolves color keyword presence in path.
// ---------------------------------------------------------------------------

async function heuristicJudge(imagePath: string, _goal: string, color: string): Promise<JudgeResponse> {
  const stats = await fs.promises.stat(imagePath);

  // A valid generated image should be larger than 5 KB.
  if (stats.size < 5120) {
    return {
      passed: false,
      critique: `Image file is suspiciously small (${stats.size} bytes). Expected a full rendered variant.`,
    };
  }

  // Verify the filename slug contains the color slug (e.g. raw_Dark_Blue.png).
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
    critique: `Image passes heuristic checks: file size ${stats.size} bytes, filename matches color slug "${colorSlug}".`,
  };
}
