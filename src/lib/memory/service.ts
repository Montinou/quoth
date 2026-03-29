/**
 * Agent Memory Service
 * MEM-02: Core CRUD + semantic search for agent memory entries.
 *
 * - Embeddings via AI Gateway (text-embedding-3-small, 1536d)
 * - Semantic search via agents.search_memory() SQL function
 * - Fire-and-forget access tracking (don't block reads)
 * - Parameterized queries only
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db/connection";
import { generateEmbedding } from "@/lib/embeddings/gateway";
import type {
  MemoryEntry,
  StoreMemoryInput,
  SearchMemoryInput,
  SearchMemoryResult,
  ListMemoryOptions,
} from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert a raw DB row into a typed MemoryEntry. */
function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    key: row.key as string,
    value: row.value as string,
    namespace: row.namespace as string,
    tier: row.tier as "working" | "persistent",
    relevanceScore: Number(row.relevance_score ?? 0),
    accessCount: Number(row.access_count ?? 0),
    tags: (row.tags as string[]) ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    source: (row.source as string) ?? "",
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Fire-and-forget: increment access_count, bump last_accessed_at,
 * and boost relevance_score by 0.03 for the given memory IDs.
 * Errors are swallowed — this must never block search results.
 */
function trackAccess(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  // noinspection JSIgnoredPromiseFromCall — intentional fire-and-forget
  db.execute(sql`
    UPDATE agents.memory
    SET access_count    = access_count + 1,
        last_accessed_at = now(),
        relevance_score  = LEAST(relevance_score + 0.03, 1.0),
        updated_at       = now()
    WHERE id = ANY(${ids}::uuid[])
  `).catch(() => {
    /* swallow — access tracking is best-effort */
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Store (upsert) a memory entry for an agent.
 * ON CONFLICT on (agent_id, namespace, key) the value, embedding, tags,
 * metadata, source, and expires_at are updated.
 */
export async function storeMemory(
  agentId: string,
  orgId: string,
  input: StoreMemoryInput,
): Promise<MemoryEntry> {
  const db = getDb();

  const namespace = input.namespace ?? "default";
  const tags = input.tags ?? [];
  const metadata = input.metadata ?? {};
  const source = input.source ?? "";

  // Generate embedding for the value text
  const embedding = await generateEmbedding(input.value);

  const expiresAt =
    input.ttlSeconds != null
      ? sql`now() + make_interval(secs => ${input.ttlSeconds})`
      : sql`NULL`;

  const rows = await db.execute(sql`
    INSERT INTO agents.memory (
      agent_id, org_id, project_id, namespace, key, value,
      embedding, tags, metadata, source, expires_at
    ) VALUES (
      ${agentId}::uuid,
      ${orgId}::uuid,
      ${input.projectId ?? null}::uuid,
      ${namespace},
      ${input.key},
      ${input.value},
      ${sql`${JSON.stringify(embedding)}::vector`},
      ${tags}::text[],
      ${JSON.stringify(metadata)}::jsonb,
      ${source},
      ${expiresAt}
    )
    ON CONFLICT (agent_id, namespace, key) DO UPDATE SET
      value         = EXCLUDED.value,
      embedding     = EXCLUDED.embedding,
      tags          = EXCLUDED.tags,
      metadata      = EXCLUDED.metadata,
      source        = EXCLUDED.source,
      expires_at    = EXCLUDED.expires_at,
      updated_at    = now()
    RETURNING *
  `);

  const row = (rows as unknown as Record<string, unknown>[])[0];
  return rowToEntry(row);
}

/**
 * Semantic search over agent memory using the agents.search_memory() SQL function.
 * Results are ordered by cosine similarity descending.
 * Accessed entries get a relevance boost (fire-and-forget).
 */
export async function searchMemory(
  agentId: string,
  input: SearchMemoryInput,
): Promise<SearchMemoryResult[]> {
  const db = getDb();

  const limit = input.limit ?? 10;
  const threshold = input.threshold ?? 0.3;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(input.query);

  const rows = await db.execute(sql`
    SELECT * FROM agents.search_memory(
      ${agentId}::uuid,
      ${sql`${JSON.stringify(queryEmbedding)}::vector`},
      ${input.namespace ?? null}::text,
      ${input.tier ?? null}::text,
      ${limit}::int,
      ${threshold}::float
    )
  `);

  const results = (rows as unknown as Record<string, unknown>[]).map(
    (row): SearchMemoryResult => ({
      ...rowToEntry(row),
      similarity: Number(row.similarity ?? 0),
    }),
  );

  // Fire-and-forget: boost relevance for accessed entries
  trackAccess(results.map((r) => r.id));

  return results;
}

/**
 * Direct lookup of a single memory entry by (agentId, namespace, key).
 * Increments access_count on hit.
 */
export async function getMemory(
  agentId: string,
  namespace: string,
  key: string,
): Promise<MemoryEntry | null> {
  const db = getDb();

  const rows = await db.execute(sql`
    SELECT * FROM agents.memory
    WHERE agent_id  = ${agentId}::uuid
      AND namespace = ${namespace}
      AND key       = ${key}
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);

  const row = (rows as unknown as Record<string, unknown>[])[0];
  if (!row) return null;

  // Fire-and-forget access tracking
  trackAccess([row.id as string]);

  return rowToEntry(row);
}

/**
 * List memory entries for an agent, ordered by relevance_score DESC.
 * Supports filtering by namespace and tier, with pagination.
 */
export async function listMemory(
  agentId: string,
  options?: ListMemoryOptions,
): Promise<MemoryEntry[]> {
  const db = getDb();

  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const namespace = options?.namespace ?? null;
  const tier = options?.tier ?? null;

  const rows = await db.execute(sql`
    SELECT * FROM agents.memory
    WHERE agent_id = ${agentId}::uuid
      AND (expires_at IS NULL OR expires_at > now())
      AND (${namespace}::text IS NULL OR namespace = ${namespace})
      AND (${tier}::text IS NULL OR tier = ${tier})
    ORDER BY relevance_score DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return (rows as unknown as Record<string, unknown>[]).map(rowToEntry);
}

/**
 * Delete a specific memory entry by (agentId, namespace, key).
 * Returns true if a row was deleted.
 */
export async function forgetMemory(
  agentId: string,
  namespace: string,
  key: string,
): Promise<boolean> {
  const db = getDb();

  const result = await db.execute(sql`
    DELETE FROM agents.memory
    WHERE agent_id  = ${agentId}::uuid
      AND namespace = ${namespace}
      AND key       = ${key}
  `);

  // Neon HTTP driver returns rowCount on the result
  return ((result as unknown as { rowCount?: number }).rowCount ?? 0) > 0;
}

/**
 * Delete all memory entries in a namespace for an agent.
 * Returns the number of deleted rows.
 */
export async function forgetNamespace(
  agentId: string,
  namespace: string,
): Promise<number> {
  const db = getDb();

  const result = await db.execute(sql`
    DELETE FROM agents.memory
    WHERE agent_id  = ${agentId}::uuid
      AND namespace = ${namespace}
  `);

  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}
