/**
 * SSE-specific Authentication Middleware
 * Supports both query param and header-based JWT authentication
 *
 * EventSource API cannot set custom headers, so SSE connections
 * must support token extraction from query parameters.
 */

import type { NextRequest } from 'next/server';
import { verifyMcpApiKey, type AuthContext } from './mcp-auth';

/**
 * Extracts JWT token from request
 * Priority: 1. Query param (?token=xxx), 2. Authorization header
 */
function extractToken(req: NextRequest): string | null {
  // 1. Check query param first (for SSE/EventSource compatibility)
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return queryToken;
  }

  // 2. Fall back to Authorization header
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Verifies JWT token and returns auth context
 * Handles custom API keys
 */
export async function verifySseToken(req: NextRequest): Promise<AuthContext | null> {
  const token = extractToken(req);

  if (!token) {
    return null;
  }

  // Use shared verification logic that supports both token types
  return verifyMcpApiKey(token);
}

/**
 * Creates an error response for SSE authentication failures
 */
export function createSseAuthErrorResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      error: 'Authentication failed',
      message,
    }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
