/**
 * POST /api/mcp-token/generate
 *
 * Generates a new MCP API key for the authenticated user's org.
 * The raw key is returned exactly once — it is hashed before storage.
 *
 * Headers:
 *   Authorization: Bearer {clerkToken}
 *
 * Body:
 *   { label: string }
 *
 * Response:
 *   { token: string, keys: [{ id, key_prefix, label, created_at, expires_at, last_used_at }] }
 */


import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth/clerk';
import { getSecureDb } from '@/db/connection';
import { agentApiKeys, agentRegistry } from '@/db/schema';
import { generateAgentApiKey } from '@/lib/auth/agent-keys';

const generateBody = z.object({
  label: z.string().min(1).max(128),
  agentId: z.string().uuid().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const ctx = await getAuthContext();

  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse and validate request body
  let body: z.infer<typeof generateBody>;
  try {
    const raw = await req.json();
    body = generateBody.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid request body. "label" is required.' }, { status: 400 });
  }

  const db = await getSecureDb(ctx.orgId, ctx.userId);

  // Resolve agentId: use provided agentId (must belong to org), or fall back to
  // the caller's own agentId (when authenticated via an agent key).
  let agentId: string;

  if (body.agentId) {
    // Verify the agent belongs to the caller's org
    const [agent] = await db
      .select({ id: agentRegistry.id })
      .from(agentRegistry)
      .where(
        and(
          eq(agentRegistry.id, body.agentId),
          eq(agentRegistry.orgId, ctx.orgId),
        ),
      )
      .limit(1);

    if (!agent) {
      return Response.json({ error: 'Agent not found in your organization.' }, { status: 404 });
    }

    agentId = agent.id;
  } else if (ctx.isAgent && ctx.agentId) {
    // Authenticated as an agent — generate key for itself
    agentId = ctx.agentId;
  } else {
    return Response.json(
      { error: 'Provide "agentId" in the request body to specify the target agent.' },
      { status: 400 },
    );
  }

  // Generate and store the key
  const { key: rawKey } = await generateAgentApiKey({
    agentId,
    orgId: ctx.orgId,
    label: body.label,
    createdBy: ctx.isAgent ? undefined : ctx.userId,
  });

  // Return updated key list (excluding the one just created's hash — only prefix visible)
  const keys = await db
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

  return Response.json({ token: rawKey, keys }, { status: 201 });
}
