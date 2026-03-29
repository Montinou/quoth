/**
 * Unified API handler wrapper for Quoth v1 routes.
 *
 * Middleware stack (executed in order):
 *   1. Request timeout (configurable, default 30 s)
 *   2. Clerk auth or agent API key authentication
 *   3. Rate limiting via Upstash Redis (sliding window)
 *   4. Zod input validation (body / query)
 *   5. Error handling with RFC 7807 responses
 *
 * Usage:
 *   export const GET = createApiHandler({ auth: 'required' }, async (req, ctx) => { ... });
 */

import type { ZodSchema } from 'zod';
import type { AuthContext } from '@/lib/auth/types';
import { getAuthContext } from '@/lib/auth/clerk';
import { rateLimit } from './rate-limit';
import { validateBody, validateQuery } from './validate';
import { AppError, errorResponse, unauthorized, rateLimited } from './errors';

// ---------------------------------------------------------------------------
// Config type
// ---------------------------------------------------------------------------

export interface HandlerConfig {
  /** 'required' = 401 if no auth, 'optional' = null ctx allowed, 'none' = skip auth */
  auth?: 'required' | 'optional' | 'none';
  /** Rate limit in requests per minute. Identifier is userId or agentId. */
  rateLimit?: { rpm: number };
  /** Maximum handler duration in milliseconds (default: 30000) */
  maxDuration?: number;
  /** Zod schemas for input validation */
  validate?: {
    body?: ZodSchema;
    query?: ZodSchema;
  };
}

// ---------------------------------------------------------------------------
// Handler context passed to route implementations
// ---------------------------------------------------------------------------

export interface HandlerRequest extends Request {
  /** Validated body (only present when config.validate.body is set) */
  validatedBody?: unknown;
  /** Validated query params (only present when config.validate.query is set) */
  validatedQuery?: unknown;
}

// ---------------------------------------------------------------------------
// createApiHandler
// ---------------------------------------------------------------------------

/**
 * Wrap a route handler with the middleware stack.
 *
 * @param config  - Auth mode, rate limits, timeout, validation schemas
 * @param handler - The actual route logic receiving (req, authContext | null)
 * @returns       - A Next.js App Router compatible handler function
 */
export function createApiHandler(
  config: HandlerConfig,
  handler: (
    req: HandlerRequest,
    context: AuthContext | null,
    params: Record<string, string>,
  ) => Promise<Response>,
) {
  const authMode = config.auth ?? 'required';
  const timeout = config.maxDuration ?? 30_000;

  return async (
    req: Request,
    routeContext?: { params?: Promise<Record<string, string>> | Record<string, string> },
  ): Promise<Response> => {
    // Resolve dynamic route params (Next.js 15+ returns a Promise)
    let params: Record<string, string> = {};
    if (routeContext?.params) {
      params =
        routeContext.params instanceof Promise
          ? await routeContext.params
          : routeContext.params;
    }

    const instance = new URL(req.url).pathname;

    try {
      // ── 1. Auth ──────────────────────────────────────────────────────
      let authCtx: AuthContext | null = null;

      if (authMode !== 'none') {
        authCtx = await getAuthContext();

        if (authMode === 'required' && !authCtx) {
          throw unauthorized();
        }
      }

      // ── 2. Rate limiting ─────────────────────────────────────────────
      if (config.rateLimit && authCtx) {
        const identifier = authCtx.agentId ?? authCtx.userId;
        const result = await rateLimit(identifier, config.rateLimit.rpm);

        if (!result.success) {
          const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
          throw rateLimited(retryAfter > 0 ? retryAfter : 1);
        }
      }

      // ── 3. Input validation ──────────────────────────────────────────
      const handlerReq = req as HandlerRequest;

      if (config.validate?.body) {
        handlerReq.validatedBody = await validateBody(req, config.validate.body);
      }

      if (config.validate?.query) {
        const url = new URL(req.url);
        handlerReq.validatedQuery = validateQuery(url, config.validate.query);
      }

      // ── 4. Execute handler with timeout ──────────────────────────────
      const result = await Promise.race([
        handler(handlerReq, authCtx, params),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new AppError({
                  type: 'https://quoth.dev/errors/timeout',
                  title: 'Request Timeout',
                  status: 504,
                  detail: `Request exceeded the ${timeout}ms time limit.`,
                }),
              ),
            timeout,
          ),
        ),
      ]);

      return result;
    } catch (error) {
      return errorResponse(error, instance);
    }
  };
}
