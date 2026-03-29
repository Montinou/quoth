/**
 * Distributed rate limiting via Upstash Redis for Quoth API v1.
 *
 * Uses sliding window algorithm from @upstash/ratelimit.
 * Env vars: KV_REST_API_URL, KV_REST_API_TOKEN.
 *
 * Falls back gracefully (allows request) when Upstash is not configured.
 */

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Unix timestamp (ms) when the window resets */
  reset: number;
}

// ---------------------------------------------------------------------------
// Singleton Redis + rate limiter cache (keyed by rpm)
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;
const _limiters = new Map<number, Ratelimit>();

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

function getLimiter(rpm: number): Ratelimit | null {
  const cached = _limiters.get(rpm);
  if (cached) return cached;

  const redis = getRedis();
  if (!redis) return null;

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(rpm, '1 m'),
    prefix: `rl:quoth:v1:${rpm}`,
  });
  _limiters.set(rpm, limiter);
  return limiter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check rate limit for a given identifier (userId or agentId).
 *
 * @param identifier - Unique caller ID from AuthContext
 * @param rpm        - Allowed requests per minute
 * @returns          - { success, remaining, reset }
 */
export async function rateLimit(
  identifier: string,
  rpm: number,
): Promise<RateLimitResult> {
  const limiter = getLimiter(rpm);

  // If Upstash is not configured, allow all requests (dev / fallback)
  if (!limiter) {
    return { success: true, remaining: rpm, reset: Date.now() + 60_000 };
  }

  const { success, remaining, reset } = await limiter.limit(identifier);
  return { success, remaining, reset };
}
