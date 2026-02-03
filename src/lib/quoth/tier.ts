/**
 * Quoth Tier System
 * Manages free/pro/team tier limits for semantic search, reranking, and RAG answers.
 * Free tier gets keyword fallback; Pro/Team get full AI pipeline.
 */

import { supabase, isSupabaseConfigured } from '../supabase';

// ============ Types ============

export type QuothTier = 'free' | 'pro' | 'team';

export interface TierLimits {
  semanticSearchesPerDay: number;  // -1 = unlimited
  rerankEnabled: boolean;
  rerankDuringGenesis: boolean;    // Allow rerank during genesis regardless of tier
  genesisAllowed: boolean;
  ragAnswersPerDay: number;        // -1 = unlimited
}

export type UsageLimitType = 'semantic_search' | 'rag_answer';

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

// ============ Tier Configuration ============

export const TIER_LIMITS: Record<QuothTier, TierLimits> = {
  free: {
    semanticSearchesPerDay: 5,
    rerankEnabled: false,
    rerankDuringGenesis: true,
    genesisAllowed: true,
    ragAnswersPerDay: 3,
  },
  pro: {
    semanticSearchesPerDay: -1,
    rerankEnabled: true,
    rerankDuringGenesis: true,
    genesisAllowed: true,
    ragAnswersPerDay: -1,
  },
  team: {
    semanticSearchesPerDay: -1,
    rerankEnabled: true,
    rerankDuringGenesis: true,
    genesisAllowed: true,
    ragAnswersPerDay: -1,
  },
};

// ============ In-Memory Usage Tracking ============

interface UsageEntry {
  count: number;
  date: string; // YYYY-MM-DD
}

// Map<`${projectId}:${limitType}`, UsageEntry>
const usageMap = new Map<string, UsageEntry>();

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getUsageKey(projectId: string, limitType: string): string {
  return `${projectId}:${limitType}`;
}

function getUsageEntry(projectId: string, limitType: string): UsageEntry {
  const key = getUsageKey(projectId, limitType);
  const today = getTodayKey();
  const entry = usageMap.get(key);

  // Reset if it's a new day
  if (!entry || entry.date !== today) {
    const newEntry = { count: 0, date: today };
    usageMap.set(key, newEntry);
    return newEntry;
  }

  return entry;
}

// ============ Tier Cache ============

// Cache tier lookups for 5 minutes to avoid repeated DB calls
const tierCache = new Map<string, { tier: QuothTier; expiresAt: number }>();
const TIER_CACHE_TTL_MS = 5 * 60 * 1000;

// ============ Public API ============

/**
 * Get the tier for a project from the database.
 * Caches result for 5 minutes.
 */
export async function getTierForProject(projectId: string): Promise<QuothTier> {
  // Check cache first
  const cached = tierCache.get(projectId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.tier;
  }

  // Default to 'free' if Supabase isn't configured
  if (!isSupabaseConfigured()) {
    return 'free';
  }

  try {
    const { data, error } = await supabase
      .from('projects')
      .select('tier')
      .eq('id', projectId)
      .single();

    if (error || !data) {
      return 'free';
    }

    const tier = (data.tier as QuothTier) || 'free';

    // Validate tier value
    if (!TIER_LIMITS[tier]) {
      return 'free';
    }

    // Cache result
    tierCache.set(projectId, {
      tier,
      expiresAt: Date.now() + TIER_CACHE_TTL_MS,
    });

    return tier;
  } catch {
    return 'free';
  }
}

/**
 * Get the tier limits for a project.
 */
export async function getTierLimits(projectId: string): Promise<TierLimits> {
  const tier = await getTierForProject(projectId);
  return TIER_LIMITS[tier];
}

/**
 * Check if a usage limit allows another operation.
 */
export async function checkUsageLimit(
  projectId: string,
  limitType: UsageLimitType
): Promise<UsageCheckResult> {
  const tier = await getTierForProject(projectId);
  const limits = TIER_LIMITS[tier];

  const limit = limitType === 'semantic_search'
    ? limits.semanticSearchesPerDay
    : limits.ragAnswersPerDay;

  // Unlimited
  if (limit === -1) {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  const entry = getUsageEntry(projectId, limitType);
  const remaining = Math.max(0, limit - entry.count);

  return {
    allowed: remaining > 0,
    remaining,
    limit,
  };
}

/**
 * Increment the usage counter for a limit type.
 */
export function incrementUsage(projectId: string, limitType: string): void {
  const key = getUsageKey(projectId, limitType);
  const today = getTodayKey();
  const entry = usageMap.get(key);

  if (!entry || entry.date !== today) {
    usageMap.set(key, { count: 1, date: today });
  } else {
    entry.count++;
  }
}

/**
 * Format a usage footer message for search results.
 * Returns empty string for pro/team tiers (no nagging).
 */
export function formatUsageFooter(
  tier: QuothTier,
  searchUsage: UsageCheckResult
): string {
  if (tier !== 'free') return '';

  if (searchUsage.limit === -1) return '';

  const used = searchUsage.limit - searchUsage.remaining;
  return `\n\n📊 Free tier: ${searchUsage.remaining}/${searchUsage.limit} semantic searches remaining today. Upgrade at triqual.dev/pro`;
}

/**
 * Check if reranking should be used for a given project and context.
 */
export async function shouldRerank(
  projectId: string,
  isGenesis: boolean = false
): Promise<boolean> {
  const limits = await getTierLimits(projectId);

  // During genesis, always allow rerank
  if (isGenesis && limits.rerankDuringGenesis) {
    return true;
  }

  return limits.rerankEnabled;
}
