/**
 * Zod validation helpers for Quoth API v1.
 *
 * Parse request body (JSON) and URL query params against Zod schemas.
 * On failure, throw AppError with structured validation details.
 */

import type { ZodSchema, ZodError } from 'zod';
import { badRequest } from './errors';

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

/**
 * Parse the JSON body of a Request against a Zod schema.
 * Returns the typed, validated result.
 * Throws AppError (400) if parsing fails or body is not valid JSON.
 */
export async function validateBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;

  try {
    raw = await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    throw badRequest('Validation failed.', {
      validationErrors: formatZodErrors(result.error),
    });
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Query validation
// ---------------------------------------------------------------------------

/**
 * Parse URL search params against a Zod schema.
 * Converts URLSearchParams to a plain object (string values) before parsing.
 * Returns the typed, validated result.
 * Throws AppError (400) if validation fails.
 */
export function validateQuery<T>(url: URL, schema: ZodSchema<T>): T {
  // Convert search params to a plain object
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const result = schema.safeParse(params);

  if (!result.success) {
    throw badRequest('Invalid query parameters.', {
      validationErrors: formatZodErrors(result.error),
    });
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Zod error formatting
// ---------------------------------------------------------------------------

interface ValidationIssue {
  path: string;
  message: string;
}

function formatZodErrors(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
