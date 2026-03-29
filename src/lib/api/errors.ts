/**
 * RFC 7807 Problem Details error responses for Quoth API v1.
 *
 * All API errors are returned as structured JSON with:
 *   type, title, status, detail, instance
 *
 * Internal details (stack traces, DB errors) are NEVER exposed.
 */

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

export class AppError extends Error {
  /** URI reference identifying the problem type (RFC 7807 "type") */
  readonly type: string;
  /** Short human-readable summary (RFC 7807 "title") */
  readonly title: string;
  /** HTTP status code */
  readonly status: number;
  /** Longer human-readable explanation */
  readonly detail: string;
  /** URI of the specific occurrence (optional) */
  readonly instance?: string;
  /** Additional structured data (validation errors, etc.) */
  readonly extensions?: Record<string, unknown>;

  constructor(opts: {
    type?: string;
    title: string;
    status: number;
    detail: string;
    instance?: string;
    extensions?: Record<string, unknown>;
  }) {
    super(opts.detail);
    this.name = 'AppError';
    this.type = opts.type ?? `https://quoth.dev/errors/${opts.status}`;
    this.title = opts.title;
    this.status = opts.status;
    this.detail = opts.detail;
    this.instance = opts.instance;
    this.extensions = opts.extensions;
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function notFound(detail = 'The requested resource was not found.'): AppError {
  return new AppError({
    type: 'https://quoth.dev/errors/not-found',
    title: 'Not Found',
    status: 404,
    detail,
  });
}

export function unauthorized(detail = 'Authentication is required.'): AppError {
  return new AppError({
    type: 'https://quoth.dev/errors/unauthorized',
    title: 'Unauthorized',
    status: 401,
    detail,
  });
}

export function forbidden(detail = 'You do not have permission to perform this action.'): AppError {
  return new AppError({
    type: 'https://quoth.dev/errors/forbidden',
    title: 'Forbidden',
    status: 403,
    detail,
  });
}

export function badRequest(
  detail = 'The request is invalid.',
  extensions?: Record<string, unknown>,
): AppError {
  return new AppError({
    type: 'https://quoth.dev/errors/bad-request',
    title: 'Bad Request',
    status: 400,
    detail,
    extensions,
  });
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError({
    type: 'https://quoth.dev/errors/rate-limited',
    title: 'Too Many Requests',
    status: 429,
    detail: `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
    extensions: { retryAfter: retryAfterSeconds },
  });
}

export function internal(detail = 'An unexpected error occurred.'): AppError {
  return new AppError({
    type: 'https://quoth.dev/errors/internal',
    title: 'Internal Server Error',
    status: 500,
    detail,
  });
}

// ---------------------------------------------------------------------------
// Response serializer
// ---------------------------------------------------------------------------

/**
 * Convert any error into an RFC 7807 JSON Response.
 *
 * - AppError instances are serialized directly.
 * - Unknown errors produce a generic 500 response — no internals are leaked.
 */
export function errorResponse(error: unknown, instance?: string): Response {
  if (error instanceof AppError) {
    const body: Record<string, unknown> = {
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.detail,
    };
    if (error.instance ?? instance) {
      body.instance = error.instance ?? instance;
    }
    if (error.extensions) {
      Object.assign(body, error.extensions);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/problem+json',
    };
    if (error.status === 429 && error.extensions?.retryAfter) {
      headers['Retry-After'] = String(error.extensions.retryAfter);
    }

    return new Response(JSON.stringify(body), {
      status: error.status,
      headers,
    });
  }

  // Unknown error — never expose internals
  console.error('[API] Unhandled error:', error);
  const fallback = internal();
  return new Response(
    JSON.stringify({
      type: fallback.type,
      title: fallback.title,
      status: fallback.status,
      detail: fallback.detail,
      ...(instance ? { instance } : {}),
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/problem+json' },
    },
  );
}
