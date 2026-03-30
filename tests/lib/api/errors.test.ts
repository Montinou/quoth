/**
 * Tests for src/lib/api/errors.ts
 *
 * Covers: AppError class, factory functions, errorResponse serializer
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AppError,
  notFound,
  unauthorized,
  forbidden,
  badRequest,
  rateLimited,
  internal,
  errorResponse,
} from '@/lib/api/errors';

// ---------------------------------------------------------------------------
// AppError class
// ---------------------------------------------------------------------------

describe('AppError', () => {
  it('has type, title, status, and detail properties', () => {
    const err = new AppError({
      type: 'https://example.com/errors/test',
      title: 'Test Error',
      status: 418,
      detail: 'I am a teapot.',
    });

    expect(err.type).toBe('https://example.com/errors/test');
    expect(err.title).toBe('Test Error');
    expect(err.status).toBe(418);
    expect(err.detail).toBe('I am a teapot.');
    expect(err.name).toBe('AppError');
  });

  it('defaults type to status-based URI when not provided', () => {
    const err = new AppError({ title: 'Oops', status: 500, detail: 'boom' });
    expect(err.type).toBe('https://quoth.dev/errors/500');
  });

  it('extends Error with detail as message', () => {
    const err = new AppError({ title: 'T', status: 400, detail: 'the detail' });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('the detail');
  });

  it('stores optional instance and extensions', () => {
    const err = new AppError({
      title: 'T',
      status: 400,
      detail: 'd',
      instance: '/api/v1/foo/123',
      extensions: { field: 'name' },
    });
    expect(err.instance).toBe('/api/v1/foo/123');
    expect(err.extensions).toEqual({ field: 'name' });
  });
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe('factory functions', () => {
  it('notFound() returns 404 AppError', () => {
    const err = notFound();
    expect(err.status).toBe(404);
    expect(err.title).toBe('Not Found');
    expect(err.type).toBe('https://quoth.dev/errors/not-found');
  });

  it('notFound() accepts custom detail', () => {
    const err = notFound('Project not found.');
    expect(err.detail).toBe('Project not found.');
  });

  it('unauthorized() returns 401 AppError', () => {
    const err = unauthorized();
    expect(err.status).toBe(401);
    expect(err.title).toBe('Unauthorized');
    expect(err.type).toBe('https://quoth.dev/errors/unauthorized');
  });

  it('forbidden() returns 403 AppError', () => {
    const err = forbidden();
    expect(err.status).toBe(403);
    expect(err.title).toBe('Forbidden');
    expect(err.type).toBe('https://quoth.dev/errors/forbidden');
  });

  it('badRequest() returns 400 AppError with optional extensions', () => {
    const err = badRequest('Invalid input.', { validationErrors: [{ path: 'name', message: 'required' }] });
    expect(err.status).toBe(400);
    expect(err.title).toBe('Bad Request');
    expect(err.extensions).toEqual({
      validationErrors: [{ path: 'name', message: 'required' }],
    });
  });

  it('rateLimited() returns 429 AppError with retryAfter extension', () => {
    const err = rateLimited(30);
    expect(err.status).toBe(429);
    expect(err.title).toBe('Too Many Requests');
    expect(err.detail).toContain('30 seconds');
    expect(err.extensions).toEqual({ retryAfter: 30 });
  });

  it('internal() returns 500 AppError', () => {
    const err = internal();
    expect(err.status).toBe(500);
    expect(err.title).toBe('Internal Server Error');
    expect(err.type).toBe('https://quoth.dev/errors/internal');
  });
});

// ---------------------------------------------------------------------------
// errorResponse
// ---------------------------------------------------------------------------

describe('errorResponse', () => {
  it('returns RFC 7807 JSON response for an AppError', async () => {
    const err = notFound('Resource gone.');
    const res = errorResponse(err);

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');

    const body = await res.json();
    expect(body.type).toBe('https://quoth.dev/errors/not-found');
    expect(body.title).toBe('Not Found');
    expect(body.status).toBe(404);
    expect(body.detail).toBe('Resource gone.');
  });

  it('includes instance when provided', async () => {
    const err = notFound();
    const res = errorResponse(err, '/api/v1/docs/abc');
    const body = await res.json();
    expect(body.instance).toBe('/api/v1/docs/abc');
  });

  it('merges extensions into the response body', async () => {
    const err = badRequest('Invalid.', { validationErrors: [{ path: 'x', message: 'bad' }] });
    const res = errorResponse(err);
    const body = await res.json();
    expect(body.validationErrors).toEqual([{ path: 'x', message: 'bad' }]);
  });

  it('sets Retry-After header for 429 errors', async () => {
    const err = rateLimited(60);
    const res = errorResponse(err);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('returns generic 500 for unknown errors and never exposes internals', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const weirdError = new Error('DB connection string: postgres://user:secret@host/db');
    const res = errorResponse(weirdError);

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toBe('application/problem+json');

    const body = await res.json();
    expect(body.title).toBe('Internal Server Error');
    expect(body.detail).toBe('An unexpected error occurred.');
    // Must not contain the original error message with credentials
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('DB connection');

    spy.mockRestore();
  });

  it('never exposes stack traces', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const err = new TypeError('Cannot read properties of undefined');
    const res = errorResponse(err);
    const body = await res.json();

    expect(body.stack).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('at ');

    spy.mockRestore();
  });
});
