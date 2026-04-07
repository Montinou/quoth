/**
 * POST /api/v1/pipeline/process
 * Core cloud endpoint for Quoth's "managed daemon" mode.
 * Receives batched trajectory sessions from local daemons and runs
 * the JUDGE -> DISTILL -> CONSOLIDATE pipeline server-side.
 * Agent API key only -- Clerk JWT rejected with 403.
 */

import { z } from 'zod';
import { createApiHandler } from '@/lib/api/handler';
import { forbidden, badRequest } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const toolEntrySchema = z.object({
  tool: z.string().min(1),
  task: z.string().min(1),
  outcome: z.enum(['success', 'failure']),
  llm_reasoning: z.string().optional(),
});

const sessionSummarySchema = z.object({
  project: z.string().min(1),
  outcome: z.enum(['success', 'failure', 'partial']),
  success_rate: z.number().min(0).max(1),
  total_calls: z.number().int().min(0),
  user_intents: z.array(z.string()),
  task: z.string().min(1),
});

const sessionSchema = z.object({
  summary: sessionSummarySchema,
  tool_entries: z.array(toolEntrySchema).max(30),
});

const existingPatternSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const processBody = z.object({
  sessions: z.array(sessionSchema).min(1).max(5),
  existing_patterns: z.array(existingPatternSchema).max(10).default([]),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Session = z.infer<typeof sessionSchema>;
type ExistingPattern = z.infer<typeof existingPatternSchema>;

interface DistilledPattern {
  pattern: string;
  tags: string[];
  applicability: 'broad' | 'narrow';
}

interface OutputPattern {
  id: string;
  pattern: string;
  tags: string[];
  applicability: 'broad' | 'narrow';
  action: 'strengthen' | 'new';
  targetId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash-lite';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha1Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

interface LlmResult {
  content: string;
  tokens: number;
}

async function callLlm(prompt: string): Promise<LlmResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY not configured');
  }

  const res = await fetch(AI_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI Gateway ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  const tokens =
    (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0);

  return { content, tokens };
}

function parseJsonResponse<T>(raw: string): T | null {
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

/** JUDGE: skip sessions with success_rate < 0.3 */
function judge(session: Session): boolean {
  return session.summary.success_rate >= 0.3;
}

/** DISTILL: extract reusable patterns from a session via one LLM call */
async function distill(session: Session): Promise<{ patterns: DistilledPattern[]; tokens: number }> {
  const { summary, tool_entries } = session;

  const intentsFormatted = summary.user_intents
    .map((intent, i) => `${i + 1}. ${intent}`)
    .join('\n');

  const entriesFormatted = tool_entries
    .slice(0, 30)
    .map(
      (e, i) =>
        `${i + 1}. [${e.tool}] ${e.task} -> ${e.outcome}${e.llm_reasoning ? ` (reasoning: ${e.llm_reasoning})` : ''}`,
    )
    .join('\n');

  const prompt = `Extract 1-3 reusable patterns from this AI agent session.

Session summary:
- Project: ${summary.project}
- Tool calls: ${summary.task}
- Success rate: ${Math.round(summary.success_rate * 100)}%
- Overall outcome: ${summary.outcome}

User intents during session:
${intentsFormatted}

Key actions and LLM reasoning:
${entriesFormatted}

RULES:
- Each pattern MUST describe a TECHNIQUE or STRATEGY, not a specific file/command
- NEVER include file paths, directory names, or raw commands
- Focus on WHAT workflow/approach worked and WHY
- Patterns should be applicable across projects
- If the session was just routine work (git status, ls, etc.), return an empty array

Respond with ONLY valid JSON (no markdown):
{"patterns": [{"pattern": "description (max 80 chars)", "tags": ["tag1","tag2"], "applicability": "broad|narrow"}]}`;

  const result = await callLlm(prompt);

  const parsed = parseJsonResponse<{ patterns: DistilledPattern[] }>(result.content);
  if (!parsed || !Array.isArray(parsed.patterns)) {
    return { patterns: [], tokens: result.tokens };
  }

  // Validate and truncate pattern text
  const validated = parsed.patterns
    .filter(
      (p) =>
        typeof p.pattern === 'string' &&
        Array.isArray(p.tags) &&
        (p.applicability === 'broad' || p.applicability === 'narrow'),
    )
    .map((p) => ({
      pattern: p.pattern.slice(0, 80),
      tags: p.tags.filter((t): t is string => typeof t === 'string').slice(0, 5),
      applicability: p.applicability as 'broad' | 'narrow',
    }));

  return { patterns: validated, tokens: result.tokens };
}

/** CONSOLIDATE: compare distilled pattern against existing ones */
async function consolidate(
  pattern: DistilledPattern,
  existing: ExistingPattern[],
): Promise<{ action: 'strengthen' | 'new'; targetId?: string; tokens: number }> {
  // No existing patterns -- everything is new
  if (existing.length === 0) {
    return { action: 'new', tokens: 0 };
  }

  const existingFormatted = existing
    .map((e) => `- [${e.id}] "${e.name}" (confidence: ${e.confidence.toFixed(2)})`)
    .join('\n');

  const prompt = `Compare this new pattern with existing ones. Should we strengthen an existing pattern or create a new one?

New pattern: ${pattern.pattern}

Existing patterns:
${existingFormatted}

Rules:
- "strengthen" = the new pattern is essentially the same technique as an existing one
- "new" = the pattern describes a genuinely different technique
- When in doubt, prefer "strengthen" to avoid duplicates

Respond with ONLY valid JSON:
{"action": "strengthen|new", "targetId": "id-if-strengthen-else-null"}`;

  const result = await callLlm(prompt);

  const parsed = parseJsonResponse<{ action: string; targetId?: string | null }>(result.content);
  if (!parsed || (parsed.action !== 'strengthen' && parsed.action !== 'new')) {
    // Default to new on parse failure
    return { action: 'new', tokens: result.tokens };
  }

  return {
    action: parsed.action as 'strengthen' | 'new',
    targetId: parsed.action === 'strengthen' && parsed.targetId ? parsed.targetId : undefined,
    tokens: result.tokens,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/pipeline/process
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 20 },
    validate: { body: processBody },
    maxDuration: 60_000,
  },
  async (req, ctx) => {
    // Agents only
    if (!ctx!.isAgent) {
      throw forbidden('Pipeline processing is only available to agent API keys.');
    }

    const body = req.validatedBody as z.infer<typeof processBody>;

    if (!process.env.AI_GATEWAY_API_KEY) {
      throw badRequest('Server-side LLM processing is not configured.');
    }

    const outputPatterns: OutputPattern[] = [];
    let totalTokens = 0;
    let sessionsProcessed = 0;

    for (const session of body.sessions) {
      // 1. JUDGE
      if (!judge(session)) {
        continue;
      }

      // 2. DISTILL
      let distilled: { patterns: DistilledPattern[]; tokens: number };
      try {
        distilled = await distill(session);
        totalTokens += distilled.tokens;
      } catch (err) {
        console.error('[pipeline/process] Distill failed for session, skipping:', err);
        continue;
      }

      if (distilled.patterns.length === 0) {
        sessionsProcessed++;
        continue;
      }

      // 3. CONSOLIDATE each distilled pattern
      for (const pattern of distilled.patterns) {
        let consolidated: { action: 'strengthen' | 'new'; targetId?: string; tokens: number };
        try {
          consolidated = await consolidate(pattern, body.existing_patterns);
          totalTokens += consolidated.tokens;
        } catch (err) {
          console.error('[pipeline/process] Consolidate failed for pattern, defaulting to new:', err);
          consolidated = { action: 'new', tokens: 0 };
        }

        const patternId = await sha1Hex(pattern.pattern);

        outputPatterns.push({
          id: patternId,
          pattern: pattern.pattern,
          tags: pattern.tags,
          applicability: pattern.applicability,
          action: consolidated.action,
          targetId: consolidated.targetId,
        });
      }

      sessionsProcessed++;
    }

    return Response.json({
      patterns: outputPatterns,
      sessions_processed: sessionsProcessed,
      tokens_used: totalTokens,
      quota_remaining: -1,
    });
  },
);
