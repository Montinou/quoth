/**
 * AI Generation Persistence - Tracker
 * QUOTH-04: Track every LLM generation with unique IDs, cost estimation, and status lifecycle.
 *
 * Stores generation records in analytics.generations via Drizzle ORM.
 * Status lifecycle: pending -> streaming -> complete | error
 */

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/connection';
import { generations } from '@/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GenerationStatus = 'pending' | 'streaming' | 'complete' | 'error';

export interface GenerationRecord {
  id: string;
  model: string;
  prompt: string;
  userId: string | null;
  projectId: string;
  status: GenerationStatus;
  result: string | null;
  tokenUsage: GenerationUsage | null;
  estimatedCostCents: number | null;
  error: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface GenerationUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ---------------------------------------------------------------------------
// Cost estimation per model (USD per 1M tokens)
// ---------------------------------------------------------------------------

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  // Google
  'gemini-2.0-flash': { input: 0.075, output: 0.30 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  // Mistral (Cloudflare Worker)
  'mistral-small-3.1-24b': { input: 0.10, output: 0.30 },
  // Embeddings
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

/**
 * Estimate cost in cents for a generation based on model + token usage.
 * Returns an integer (cents) for storage in estimated_cost_cents column.
 */
export function estimateCostCents(model: string, usage: GenerationUsage): number {
  // Try exact match first, then prefix match
  const costs = MODEL_COSTS[model] ?? findCostByPrefix(model);
  if (!costs) return 0;

  const inputCostUsd = (usage.prompt_tokens / 1_000_000) * costs.input;
  const outputCostUsd = (usage.completion_tokens / 1_000_000) * costs.output;
  const totalUsd = inputCostUsd + outputCostUsd;
  // Convert to cents and round to nearest integer
  return Math.round(totalUsd * 100);
}

function findCostByPrefix(model: string): { input: number; output: number } | null {
  for (const [key, value] of Object.entries(MODEL_COSTS)) {
    if (model.startsWith(key)) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generation Lifecycle
// ---------------------------------------------------------------------------

/**
 * Check if Drizzle DB is configured (DATABASE_URL exists).
 */
function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Create a new pending generation record.
 *
 * @param model - LLM model identifier
 * @param prompt - Input prompt (truncated to 10KB for storage)
 * @param userId - Optional user ID
 * @param projectId - Project ID (required by schema)
 * @returns Generation ID (nanoid, 21 chars)
 */
export async function createGeneration(
  model: string,
  prompt: string,
  userId?: string | null,
  projectId?: string,
): Promise<string> {
  const id = nanoid();
  const truncatedPrompt = prompt.length > 10_000 ? prompt.slice(0, 10_000) + '...' : prompt;

  if (!isDbConfigured()) {
    console.warn('[GENERATIONS] Database not configured, generation not persisted:', id);
    return id;
  }

  try {
    const db = getDb();
    await db
      .insert(generations)
      .values({
        id,
        model,
        prompt: truncatedPrompt,
        userId: userId ?? null,
        projectId: projectId ?? '',
        status: 'pending',
      });
  } catch (error) {
    // Non-blocking: log but don't fail the generation
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GENERATIONS] Failed to create record:', message);
  }

  return id;
}

/**
 * Mark a generation as streaming (in progress).
 *
 * @param id - Generation ID
 */
export async function streamGeneration(id: string): Promise<void> {
  if (!isDbConfigured()) return;

  try {
    const db = getDb();
    await db
      .update(generations)
      .set({ status: 'streaming' })
      .where(eq(generations.id, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GENERATIONS] Failed to mark streaming:', message);
  }
}

/**
 * Mark a generation as complete with result and usage data.
 *
 * @param id - Generation ID
 * @param result - LLM output text (truncated to 50KB)
 * @param usage - Token usage counts
 */
export async function completeGeneration(
  id: string,
  result: string,
  usage: GenerationUsage,
): Promise<void> {
  if (!isDbConfigured()) return;

  const truncatedResult = result.length > 50_000 ? result.slice(0, 50_000) + '...' : result;

  try {
    const db = getDb();

    // Get model from existing record for cost estimation
    const [existing] = await db
      .select({ model: generations.model })
      .from(generations)
      .where(eq(generations.id, id))
      .limit(1);

    const costCents = existing ? estimateCostCents(existing.model, usage) : 0;

    await db
      .update(generations)
      .set({
        status: 'complete',
        result: truncatedResult,
        tokenUsage: usage,
        estimatedCostCents: costCents,
      })
      .where(eq(generations.id, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GENERATIONS] Failed to complete record:', message);
  }
}

/**
 * Mark a generation as failed with error details.
 * Uses the status column ('error') since there is no separate error_message column.
 * Error detail is stored alongside the status update.
 *
 * @param id - Generation ID
 * @param errorMessage - Error description (stored in result as fallback)
 */
export async function failGeneration(
  id: string,
  errorMessage: string,
): Promise<void> {
  if (!isDbConfigured()) return;

  try {
    const db = getDb();
    await db
      .update(generations)
      .set({
        status: 'error',
        // Store error in result field since schema has no error_message column
        result: `[ERROR] ${errorMessage.slice(0, 2000)}`,
      })
      .where(eq(generations.id, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GENERATIONS] Failed to mark error:', message);
  }
}

/**
 * Fetch a generation record by ID.
 *
 * @param id - Generation ID
 * @returns Generation record or null
 */
export async function getGeneration(id: string): Promise<GenerationRecord | null> {
  if (!isDbConfigured()) return null;

  try {
    const db = getDb();
    const [data] = await db
      .select()
      .from(generations)
      .where(eq(generations.id, id))
      .limit(1);

    if (!data) return null;

    return {
      id: data.id,
      model: data.model,
      prompt: data.prompt,
      userId: data.userId,
      projectId: data.projectId,
      status: data.status as GenerationStatus,
      result: data.result,
      tokenUsage: data.tokenUsage as GenerationUsage | null,
      estimatedCostCents: data.estimatedCostCents,
      error: data.status === 'error' ? data.result : null,
      createdAt: data.createdAt,
      updatedAt: null, // schema uses createdAt only
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GENERATIONS] Failed to get record:', message);
    return null;
  }
}
