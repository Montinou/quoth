/**
 * POST /api/mcp-token/generate
 *
 * Generates a new MCP API key for the authenticated user's org.
 * The raw key is returned exactly once — it is hashed before storage.
 */

import { randomBytes } from 'crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAuthContext } from '@/lib/auth/clerk';
import { getDb } from '@/db/connection';
import { agentApiKeys, agentRegistry } from '@/db/schema';
import { generateAgentApiKey } from '@/lib/auth/agent-keys';

const generateBody = z.object({
  label: z.string().min(1).max(128),
  agentId: z.string().uuid().optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
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

    if (!ctx.orgId) {
      return Response.json({ error: 'No organization found. Please select an organization first.' }, { status: 400 });
    }

    // Use service DB (no RLS) — this is an admin action
    const db = getDb();

    // Resolve internal user UUID from Clerk ID
    let internalUserId: string | undefined;
    if (!ctx.isAgent && ctx.userId) {
      const result = await db.execute<{ id: string }>(
        sql`SELECT id FROM public.users WHERE clerk_user_id = ${ctx.userId} LIMIT 1`
      );
      const userRow = result.rows[0] as { id: string } | undefined;
      internalUserId = userRow?.id;
    }

    // Resolve agentId
    let agentId: string;

    if (body.agentId) {
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
      agentId = ctx.agentId;
    } else {
      // Auto-upsert default claude-code agent
      const [created] = await db
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

      if (created) {
        agentId = created.id;
      } else {
        const [existing] = await db
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

    // Generate and store the key
    const { key: rawKey } = await generateAgentApiKey({
      agentId,
      orgId: ctx.orgId,
      label: body.label,
      createdBy: internalUserId,
    });

    // Return updated key list
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
  } catch (err) {
    console.error('[generate-token] Unhandled error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: 'Failed to generate token.', detail: message }, { status: 500 });
  }
}
