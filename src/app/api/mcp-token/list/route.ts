/**
 * GET /api/mcp-token/list
 *
 * Returns all active (non-revoked) API keys for the authenticated user's org.
 * Joins agents.api_keys with agents.registry filtered by org_id.
 *
 * Headers:
 *   Authorization: Bearer {clerkToken}
 *
 * Response:
 *   { keys: [{ id, key_prefix, label, created_at, expires_at, last_used_at }] }
 */

export const runtime = 'nodejs';

import { eq, and, isNull } from 'drizzle-orm';
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { agentApiKeys, agentRegistry } from '@/db/schema';

export async function GET(): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();

  const rows = await db
    .select({
      id: agentApiKeys.id,
      key_prefix: agentApiKeys.keyPrefix,
      label: agentApiKeys.label,
      created_at: agentApiKeys.createdAt,
      expires_at: agentApiKeys.expiresAt,
      last_used_at: agentApiKeys.lastUsedAt,
    })
    .from(agentApiKeys)
    .innerJoin(agentRegistry, eq(agentApiKeys.agentId, agentRegistry.id))
    .where(
      and(
        eq(agentApiKeys.orgId, ctx.orgId),
        isNull(agentApiKeys.revokedAt),
      ),
    )
    .orderBy(agentApiKeys.createdAt);

  return Response.json({ keys: rows });
}
