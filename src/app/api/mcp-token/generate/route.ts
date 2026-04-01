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


import { randomBytes } from 'crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb, getSecureDb } from '@/db/connection';
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
  // the caller's own agentId (when authenticated via an agent key), or
  // auto-upsert a default claude-code agent for human callers.
  let agentId: string;

  if (body.agentId) {
    // Caller specified an agent — verify it belongs to this org
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
    // Agent generating a key for itself
    agentId = ctx.agentId;
  } else {
    // Human caller with no agentId — auto-upsert the org's default claude-code agent
    if (!ctx.orgId) {
      return Response.json({ error: 'No organization found for your account.' }, { status: 400 });
    }

    const serviceDb = getDb();

    // Upsert: insert the claude-code agent, ignore if it already exists
    const [created] = await serviceDb
      .insert(agentRegistry)
      .values({
        orgId: ctx.orgId,
        agentName: 'claude-code',
        displayName: 'Claude Code',
        instance: `user-${ctx.userId}`,
        role: 'agent',
        signingKey: randomBytes(32).toString('hex'),
      })
      .onConflictDoNothing()
      .returning({ id: agentRegistry.id });

    // If insert was a no-op (conflict), fetch the existing row
    if (created) {
      agentId = created.id;
    } else {
      const [existing] = await serviceDb
        .select({ id: agentRegistry.id })
        .from(agentRegistry)
        .where(
          and(
            eq(agentRegistry.orgId, ctx.orgId),
            eq(agentRegistry.agentName, 'claude-code'),
          ),
        )
        .limit(1);

      if (!existing) {
        return Response.json({ error: 'Failed to initialize agent.' }, { status: 500 });
      }

      agentId = existing.id;
    }
  }

  // Resolve internal user UUID for createdBy (ctx.userId is Clerk ID, column needs users.id UUID)
  let internalUserId: string | undefined;
  if (!ctx.isAgent && ctx.userId) {
    const serviceDb = getDb();
    const result = await serviceDb.execute<{ id: string }>(
      sql`SELECT id FROM public.users WHERE clerk_user_id = ${ctx.userId} LIMIT 1`
    );
    const userRow = result.rows[0] as { id: string } | undefined;
    internalUserId = userRow?.id;
  }

  // Generate and store the key
  let rawKey: string;
  try {
    const { key } = await generateAgentApiKey({
      agentId,
      orgId: ctx.orgId,
      label: body.label,
      createdBy: internalUserId,
    });
    rawKey = key;
  } catch (err) {
    console.error('[generate-token] Key generation failed:', err);
    return Response.json({ error: 'Failed to generate token.' }, { status: 500 });
  }

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
