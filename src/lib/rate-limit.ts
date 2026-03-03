/**
 * Rate Limiting Utility
 * In-memory rate limiter for API endpoints
 *
 * Note: For production with multiple serverless instances, consider:
 * - Vercel KV (Redis-compatible)
 * - Upstash Rate Limit
 * - Cloudflare Rate Limiting
 *
 * This in-memory implementation works for:
 * - Single instance deployments
 * - Development/testing
 * - Basic protection (each instance has its own counter)
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // Milliseconds until reset
}

// In-memory store for rate limits
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup interval to prevent memory leaks (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupScheduled = false;

function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
}

/**
 * Check rate limit for a given identifier
 *
 * @param identifier - Unique identifier (e.g., IP address, user ID, API key prefix)
 * @param options - Rate limit configuration
 * @returns RateLimitResult with allowed status and metadata
 *
 * @example
 * ```typescript
 * const result = checkRateLimit(`user:${userId}`, {
 *   windowMs: 60 * 1000, // 1 minute
 *   maxRequests: 60, // 60 requests per minute
 * });
 *
 * if (!result.allowed) {
 *   return new Response('Too many requests', { status: 429 });
 * }
 * ```
 */
export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions
): RateLimitResult {
  scheduleCleanup();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // No existing entry or window has reset
  if (!entry || entry.resetAt < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + options.windowMs,
    };
    rateLimitStore.set(identifier, newEntry);

    return {
      allowed: true,
      remaining: options.maxRequests - 1,
      resetIn: options.windowMs,
    };
  }

  // Window is active, check limit
  const resetIn = entry.resetAt - now;

  if (entry.count >= options.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetIn,
    };
  }

  // Increment counter
  entry.count += 1;
  rateLimitStore.set(identifier, entry);

  return {
    allowed: true,
    remaining: options.maxRequests - entry.count,
    resetIn,
  };
}

/**
 * Preset rate limit configurations
 */
export const RateLimits = {
  // Public endpoints (unauthenticated)
  PUBLIC_SEARCH: { windowMs: 60 * 1000, maxRequests: 10 },
  PUBLIC_READ: { windowMs: 60 * 1000, maxRequests: 20 },

  // Authenticated endpoints
  AUTH_SEARCH: { windowMs: 60 * 1000, maxRequests: 60 },
  AUTH_READ: { windowMs: 60 * 1000, maxRequests: 120 },
  AUTH_WRITE: { windowMs: 60 * 1000, maxRequests: 30 },

  // Token generation
  TOKEN_GENERATE: { windowMs: 60 * 60 * 1000, maxRequests: 10 }, // 10 per hour

  // Genesis (expensive operation)
  GENESIS: { windowMs: 60 * 60 * 1000, maxRequests: 3 }, // 3 per hour
} as const;

/**
 * Create rate limit middleware for Next.js API routes
 *
 * @example
 * ```typescript
 * const rateLimitMiddleware = createRateLimitMiddleware(
 *   (req) => req.headers.get('x-forwarded-for') || 'anonymous',
 *   RateLimits.AUTH_SEARCH
 * );
 *
 * export async function POST(req: NextRequest) {
 *   const rateLimitResponse = rateLimitMiddleware(req);
 *   if (rateLimitResponse) return rateLimitResponse;
 *
 *   // Handle request...
 * }
 * ```
 */
export function createRateLimitMiddleware(
  getIdentifier: (req: Request) => string,
  options: RateLimitOptions
) {
  return (req: Request): Response | null => {
    const identifier = getIdentifier(req);
    const result = checkRateLimit(identifier, options);

    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          error: 'rate_limit_exceeded',
          error_description: 'Too many requests. Please wait before trying again.',
          retry_after: Math.ceil(result.resetIn / 1000),
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(result.resetIn / 1000)),
            'X-RateLimit-Limit': String(options.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(
              Math.ceil(Date.now() / 1000 + result.resetIn / 1000)
            ),
          },
        }
      );
    }

    return null; // Request allowed
  };
}

/**
 * Get IP address from request headers
 * Handles common proxy headers
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') || // Cloudflare
    'anonymous'
  );
}

/**
 * Clear rate limit for an identifier (for testing)
 */
export function clearRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}

/**
 * Clear all rate limits (for testing)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}

/**
 * Upstash Redis rate limiting for Next.js middleware
 * Global rate limit: 60 req/min per IP
 */
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

let _upstashLimiter: Ratelimit | null = null;

function getUpstashLimiter(): Ratelimit | null {
  if (_upstashLimiter) return _upstashLimiter;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  _upstashLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "1 m"), prefix: "rl:quoth" });
  return _upstashLimiter;
}

export async function checkUpstashRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const limiter = getUpstashLimiter();
  if (!limiter) return null; // No Upstash configured, skip
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.match(/\.(ico|svg|png|jpg|css|js|woff2?)$/)) return null;
  const ip = getClientIp(request);
  const { success, reset } = await limiter.limit(ip);
  if (!success) {
    const r = Math.ceil((reset - Date.now()) / 1000);
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(r) } })
      : new NextResponse("Too many requests.", { status: 429, headers: { "Retry-After": String(r) } });
  }
  return null;
}
