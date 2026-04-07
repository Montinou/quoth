/**
 * POST /api/v1/docs/update
 * Cloud endpoint for managed-mode doc auto-updates.
 * Receives a stale doc + changed source files, runs LLM server-side,
 * and returns the updated markdown with a bumped patch version.
 * Agent API key only -- Clerk JWT rejected with 403.
 */

import { z } from 'zod';
import { createApiHandler } from '@/lib/api/handler';
import { forbidden, badRequest } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const sourceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
});

const docSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver (e.g. 1.0.1)'),
});

const updateBody = z.object({
  doc: docSchema,
  source_files: z.array(sourceFileSchema).min(1).max(10),
  project: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash-lite';
const MAX_SOURCE_CHARS = 10_000;
const MAX_TOKENS = 4_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bumpPatchVersion(version: string): string {
  const parts = version.split('.');
  parts[2] = String(Number(parts[2]) + 1);
  return parts.join('.');
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '\n... [truncated]';
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
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
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
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

/**
 * Strip markdown fences that LLMs sometimes wrap around the response.
 */
function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:markdown|md)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

/**
 * Extract a short changes summary from the diff between old and new content.
 * Falls back to a second (cheap) LLM call only if we have tokens budget.
 */
function buildSummaryPrompt(
  filename: string,
  oldContent: string,
  newContent: string,
): string {
  return `Compare the original and updated versions of "${filename}" and write a 1-2 sentence summary of what changed. Be specific about sections/topics modified.

Original (first 2000 chars):
${oldContent.slice(0, 2000)}

Updated (first 2000 chars):
${newContent.slice(0, 2000)}

Respond with ONLY the summary text, no markdown formatting.`;
}

// ---------------------------------------------------------------------------
// POST /api/v1/docs/update
// ---------------------------------------------------------------------------

export const POST = createApiHandler(
  {
    auth: 'required',
    rateLimit: { rpm: 10 },
    validate: { body: updateBody },
    maxDuration: 120_000,
  },
  async (req, ctx) => {
    // Agents only
    if (!ctx!.isAgent) {
      throw forbidden('Doc updates are only available to agent API keys.');
    }

    const body = req.validatedBody as z.infer<typeof updateBody>;

    if (!process.env.AI_GATEWAY_API_KEY) {
      throw badRequest('Server-side LLM processing is not configured.');
    }

    const { doc, source_files, project } = body;
    const newVersion = bumpPatchVersion(doc.version);
    const today = todayISO();

    // Build source file context with truncation
    const sourceContext = source_files
      .map((f) => `--- ${f.path} ---\n${truncate(f.content, MAX_SOURCE_CHARS)}`)
      .join('\n\n');

    const updatePrompt = `Update this documentation file to reflect the current source code.

Documentation file: ${doc.filename}
Current content:
${doc.content}

Changed source files:
${sourceContext}

Rules:
- Make targeted edits only. Do not rewrite unchanged sections.
- Preserve the existing markdown structure and formatting.
- Update version from ${doc.version} to ${newVersion} in the frontmatter.
- Update the "Last Updated" date to ${today}.
- Return ONLY the updated markdown content, no explanation.`;

    // 1. Run the doc update
    let updateResult: LlmResult;
    try {
      updateResult = await callLlm(updatePrompt);
    } catch (err) {
      console.error(`[docs/update] LLM call failed for ${project}/${doc.filename}:`, err);
      throw badRequest('LLM processing failed. Please retry.');
    }

    const updatedContent = stripFences(updateResult.content);
    let totalTokens = updateResult.tokens;

    // 2. Generate changes summary
    let changesSummary = 'Documentation updated to reflect current source code.';
    try {
      const summaryResult = await callLlm(
        buildSummaryPrompt(doc.filename, doc.content, updatedContent),
      );
      totalTokens += summaryResult.tokens;
      const summary = summaryResult.content.trim();
      if (summary.length > 0 && summary.length < 500) {
        changesSummary = summary;
      }
    } catch {
      // Non-critical -- keep the default summary
    }

    return Response.json({
      updated_content: updatedContent,
      new_version: newVersion,
      changes_summary: changesSummary,
      tokens_used: totalTokens,
    });
  },
);
