/**
 * Tests for src/lib/api/validate.ts
 *
 * Covers: validateBody, validateQuery
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery } from '@/lib/api/validate';
import { AppError } from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// validateBody
// ---------------------------------------------------------------------------

describe('validateBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    count: z.number().int().positive(),
  });

  it('parses valid JSON body and returns typed result', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hello', count: 5 }),
    });

    const result = await validateBody(req, schema);
    expect(result).toEqual({ name: 'hello', count: 5 });
  });

  it('throws AppError 400 on invalid JSON', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });

    await expect(validateBody(req, schema)).rejects.toThrow(AppError);

    try {
      await validateBody(req, schema);
    } catch (err) {
      // Need a fresh request since body was already consumed
    }

    // Create a fresh request for the assertion
    const req2 = new Request('http://localhost/api/test', {
      method: 'POST',
      body: 'not json',
    });

    try {
      await validateBody(req2, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(400);
      expect((err as AppError).detail).toContain('valid JSON');
    }
  });

  it('throws AppError 400 when body does not match schema', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', count: -1 }),
    });

    try {
      await validateBody(req, schema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(400);
      expect((err as AppError).detail).toBe('Validation failed.');
      expect((err as AppError).extensions).toHaveProperty('validationErrors');
      const errors = (err as AppError).extensions!.validationErrors as Array<{
        path: string;
        message: string;
      }>;
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('returns typed result matching the Zod schema', async () => {
    const strictSchema = z.object({
      id: z.string().uuid(),
      tags: z.array(z.string()),
    });

    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: '550e8400-e29b-41d4-a716-446655440000',
        tags: ['a', 'b'],
      }),
    });

    const result = await validateBody(req, strictSchema);
    // TypeScript type is inferred; at runtime we check shape
    expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.tags).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// validateQuery
// ---------------------------------------------------------------------------

describe('validateQuery', () => {
  const schema = z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
    q: z.string().optional(),
  });

  it('parses URL search params and returns typed result', () => {
    const url = new URL('http://localhost/api/search?page=2&limit=10&q=hello');
    const result = validateQuery(url, schema);

    expect(result).toEqual({ page: '2', limit: '10', q: 'hello' });
  });

  it('applies schema defaults for missing params', () => {
    const url = new URL('http://localhost/api/search');
    const result = validateQuery(url, schema);

    expect(result.page).toBe('1');
    expect(result.limit).toBe('20');
    expect(result.q).toBeUndefined();
  });

  it('throws AppError 400 when query params fail validation', () => {
    const strictSchema = z.object({
      status: z.enum(['active', 'inactive']),
    });

    const url = new URL('http://localhost/api/items?status=bogus');

    try {
      validateQuery(url, strictSchema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(400);
      expect((err as AppError).detail).toBe('Invalid query parameters.');
      expect((err as AppError).extensions).toHaveProperty('validationErrors');
    }
  });

  it('returns typed results matching the Zod schema', () => {
    const typedSchema = z.object({
      projectId: z.string().uuid(),
      verbose: z.string().optional(),
    });

    const url = new URL(
      'http://localhost/api/data?projectId=550e8400-e29b-41d4-a716-446655440000&verbose=true',
    );

    const result = validateQuery(url, typedSchema);
    expect(result.projectId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.verbose).toBe('true');
  });
});
