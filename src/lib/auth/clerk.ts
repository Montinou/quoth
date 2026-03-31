/**
 * Clerk authentication helpers for Quoth
 *
 * Combined auth flow:
 *   1. Try Clerk JWT (from @clerk/nextjs auth())
 *   2. Fall back to agent API key header (x-api-key / Authorization: Bearer qth_...)
 *
 * Legacy MCP JWT auth is preserved in mcp-auth.ts for backward compatibility.
 */

import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { sql } from 'drizzle-orm';
import type { AuthContext, ClerkJwtClaims } from './types';
import { verifyAgentApiKey } from './agent-keys';

/**
 * Extract AuthContext from the current Clerk session.
 * Reads session claims injected by the "quoth-mcp" JWT template.
 * Falls back to DB lookup for project_id when JWT claim is missing.
 *
 * Returns null when no active Clerk session exists.
 */
export async function getClerkAuthContext(): Promise<AuthContext | null> {
  const { userId, orgId, sessionClaims } = await auth();

  if (!userId) {
    return null;
  }

  const claims = (sessionClaims ?? {}) as unknown as ClerkJwtClaims;

  // project_id comes from user.public_metadata.default_project_id via JWT template
  let projectId = claims.project_id ?? '';

  // Fallback: if JWT template is not configured or user hasn't synced metadata,
  // look up default_project_id from the users table
  if (!projectId) {
    try {
      const { getDb } = await import('@/db/connection');
      const db = getDb();
      const rows = await db.execute<{ default_project_id: string | null; default_org_id: string | null }>(sql`
        SELECT default_project_id, default_org_id
        FROM public.users
        WHERE clerk_user_id = ${userId}
        LIMIT 1
      `);
      const row = rows.rows[0] as { default_project_id: string | null; default_org_id: string | null } | undefined;
      projectId = row?.default_project_id ?? '';
    } catch {
      // DB lookup failed — proceed without project_id
    }
  }

  const roleMap: Record<string, AuthContext['role']> = {
    'org:admin': 'admin',
    'org:member': 'editor',
    admin: 'admin',
    member: 'editor',
    owner: 'owner',
  };

  const rawRole = claims.org_role ?? '';
  const role: AuthContext['role'] = roleMap[rawRole] ?? 'viewer';

  const tier = (['free', 'pro', 'team', 'enterprise'].includes(claims.tier ?? '')
    ? claims.tier
    : 'free') as AuthContext['tier'];

  return {
    userId,
    clerkUserId: userId,
    orgId: orgId ?? claims.org_id ?? '',
    projectId,
    role,
    tier,
    isAgent: false,
  };
}

/**
 * Extract AuthContext from an agent API key sent in request headers.
 * Checks both `x-api-key` header and `Authorization: Bearer qth_...` header.
 *
 * Returns null when no valid agent key is found.
 */
async function getAgentAuthContext(): Promise<AuthContext | null> {
  const hdrs = await headers();

  // Check x-api-key first, then Authorization header for qth_ prefixed keys
  let rawKey = hdrs.get('x-api-key');

  if (!rawKey) {
    const authHeader = hdrs.get('authorization');
    if (authHeader?.startsWith('Bearer qth_')) {
      rawKey = authHeader.substring(7);
    }
  }

  if (!rawKey || !rawKey.startsWith('qth_')) {
    return null;
  }

  const payload = await verifyAgentApiKey(rawKey);
  if (!payload) {
    return null;
  }

  // Use the first allowed project, or empty string if unrestricted
  const projectId =
    payload.project_ids && payload.project_ids.length > 0
      ? payload.project_ids[0]
      : '';

  return {
    userId: payload.agent_id, // agents use their agent_id as userId
    clerkUserId: null, // agents don't have Clerk user IDs
    orgId: payload.org_id,
    projectId,
    role: 'editor', // agents default to editor; scopes control fine-grained access
    tier: 'team', // agents belong to team/enterprise orgs
    isAgent: true,
    agentId: payload.agent_id,
    scopes: payload.scopes,
  };
}

/**
 * Combined auth: try Clerk JWT first, then agent API key header.
 * This is the primary entry point for route handlers and server actions.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  // 1. Try Clerk session (human users)
  const clerkCtx = await getClerkAuthContext();
  if (clerkCtx) {
    return clerkCtx;
  }

  // 2. Fall back to agent API key
  return getAgentAuthContext();
}
