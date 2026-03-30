/**
 * MCP-specific authentication layer.
 *
 * Verifies SSE Bearer tokens (Clerk JWT) and agent API keys (qth_ prefix),
 * returning a unified AuthContext consumed by every MCP tool handler.
 *
 * This module delegates to:
 *   - @/lib/auth/clerk   → Clerk JWT verification (human users)
 *   - @/lib/auth/agent-keys → agent API key verification (qth_ keys)
 */

import type { NextRequest } from 'next/server';
import { verifyAgentApiKey } from '@/lib/auth/agent-keys';
import type { AuthContext, AgentKeyPayload } from '@/lib/auth/types';

/**
 * Extract a Bearer token from a Next.js request.
 *
 * Priority:
 *   1. Query param `?token=...` (EventSource cannot set headers)
 *   2. `Authorization: Bearer ...` header
 *   3. `x-api-key` header (agent keys)
 */
function extractToken(req: NextRequest): string | null {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  const apiKey = req.headers.get('x-api-key');
  if (apiKey) return apiKey;

  return null;
}

/**
 * Build AuthContext from a verified agent API key payload.
 */
function agentPayloadToAuthContext(payload: AgentKeyPayload): AuthContext {
  const projectId =
    payload.project_ids && payload.project_ids.length > 0
      ? payload.project_ids[0]
      : '';

  return {
    userId: payload.agent_id,
    clerkUserId: null,
    orgId: payload.org_id,
    projectId,
    role: 'editor',
    tier: 'team',
    isAgent: true,
    agentId: payload.agent_id,
    scopes: payload.scopes,
  };
}

/**
 * Verify a Clerk JWT token from the SSE connection.
 *
 * Uses the `@clerk/nextjs` `verifyToken` helper with the Clerk publishable/secret
 * key pair configured in env vars.
 *
 * Returns null when:
 *   - CLERK_SECRET_KEY is not set
 *   - the token is invalid / expired
 *   - the JWT template lacks required claims (project_id)
 */
async function verifyClerkBearerToken(token: string): Promise<AuthContext | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    // Dynamic import so we don't blow up if Clerk isn't installed
    const { verifyToken } = await import('@clerk/backend');

    const payload = await verifyToken(token, {
      secretKey,
    });

    if (!payload?.sub) return null;

    // Read custom claims from "quoth-mcp" JWT template
    const claims = (payload as Record<string, unknown>) ?? {};
    const metadata = (claims.metadata ?? {}) as Record<string, unknown>;
    const projectId = (claims.project_id ?? metadata.project_id ?? '') as string;

    if (!projectId) {
      console.warn('[MCP Auth] Clerk token missing project_id claim');
      return null;
    }

    const roleMap: Record<string, AuthContext['role']> = {
      'org:admin': 'admin',
      'org:member': 'editor',
      admin: 'admin',
      member: 'editor',
      owner: 'owner',
    };

    const rawRole = (claims.org_role ?? '') as string;
    const role: AuthContext['role'] = roleMap[rawRole] ?? 'viewer';

    const tier = (['free', 'pro', 'team', 'enterprise'].includes(claims.tier as string ?? '')
      ? claims.tier
      : 'free') as AuthContext['tier'];

    return {
      userId: payload.sub,
      clerkUserId: payload.sub,
      orgId: (claims.org_id ?? '') as string,
      projectId,
      role,
      tier,
      isAgent: false,
    };
  } catch (err) {
    console.error('[MCP Auth] Clerk token verification failed:', err);
    return null;
  }
}

/**
 * Primary entry point: verify an SSE request and return an AuthContext.
 *
 * Flow:
 *   1. Extract token from request (query param / header)
 *   2. If token starts with `qth_`, verify as agent API key
 *   3. Otherwise, verify as Clerk JWT
 *   4. Return null if nothing matches
 */
export async function verifyMcpToken(req: NextRequest): Promise<AuthContext | null> {
  const token = extractToken(req);
  if (!token) return null;

  // Agent API keys have `qth_` prefix
  if (token.startsWith('qth_')) {
    const payload = await verifyAgentApiKey(token);
    if (!payload) return null;
    return agentPayloadToAuthContext(payload);
  }

  // Human users authenticate via Clerk JWT
  return verifyClerkBearerToken(token);
}

export type { AuthContext };
