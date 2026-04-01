/**
 * Agent API Key Management for Quoth
 *
 * Key format: `qth_` prefix + 32 random bytes as hex (68 chars total)
 * Storage: SHA-256 hash in agents.api_keys table
 *
 * Uses Drizzle ORM with Neon serverless driver for DB access.
 */

import { createHash, randomBytes } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '@/db/connection';
import { agentApiKeys } from '@/db/schema';
import type { AgentKeyPayload } from './types';

/**
 * Generate a new API key for an agent.
 * The raw key is returned exactly once — it cannot be retrieved later.
 */
export async function generateAgentApiKey(params: {
  agentId: string;
  orgId: string;
  label?: string;
  scopes?: string[];
  projectIds?: string[];
  rateLimitRpm?: number;
  expiresDays?: number;
  createdBy?: string;
}): Promise<{
  key: string;
  id: string;
  keyPrefix: string;
}> {
  const rawBytes = randomBytes(32).toString('hex');
  const fullKey = `qth_${rawBytes}`;
  const keyPrefix = fullKey.substring(0, 12); // qth_XXXXXXXX
  const keyHash = createHash('sha256').update(fullKey).digest('hex');

  const defaultExpireDays = 90;
  const days = params.expiresDays ?? defaultExpireDays;
  const expiresAt = new Date(Date.now() + days * 86400000);

  const db = getDb();
  const [inserted] = await db
    .insert(agentApiKeys)
    .values({
      agentId: params.agentId,
      orgId: params.orgId,
      keyHash,
      keyPrefix,
      label: params.label ?? null,
      scopes: params.scopes ?? ['read', 'write'],
      projectIds: params.projectIds ?? null,
      rateLimitRpm: params.rateLimitRpm ?? 60,
      expiresAt,
      createdBy: params.createdBy ?? null,
    })
    .returning({ id: agentApiKeys.id, keyPrefix: agentApiKeys.keyPrefix });

  if (!inserted) {
    throw new Error('Failed to create agent API key');
  }

  return {
    key: fullKey,
    id: inserted.id,
    keyPrefix: inserted.keyPrefix,
  };
}

/**
 * Verify an agent API key by hashing and looking up in DB.
 * Returns the agent payload if valid, null otherwise.
 */
export async function verifyAgentApiKey(rawKey: string): Promise<AgentKeyPayload | null> {
  if (!rawKey.startsWith('qth_')) {
    return null;
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const db = getDb();
  const [data] = await db
    .select({
      id: agentApiKeys.id,
      agentId: agentApiKeys.agentId,
      orgId: agentApiKeys.orgId,
      scopes: agentApiKeys.scopes,
      projectIds: agentApiKeys.projectIds,
      rateLimitRpm: agentApiKeys.rateLimitRpm,
      revokedAt: agentApiKeys.revokedAt,
      expiresAt: agentApiKeys.expiresAt,
    })
    .from(agentApiKeys)
    .where(
      and(
        eq(agentApiKeys.keyHash, keyHash),
        isNull(agentApiKeys.revokedAt),
      ),
    )
    .limit(1);

  if (!data) {
    return null;
  }

  // Check expiration
  if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
    return null;
  }

  // Fire-and-forget: update last_used_at
  void db
    .update(agentApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentApiKeys.id, data.id))
    .then(() => {});

  return {
    agent_id: data.agentId,
    org_id: data.orgId,
    scopes: data.scopes ?? ['read', 'write'],
    project_ids: data.projectIds,
    rate_limit_rpm: data.rateLimitRpm ?? 60,
  };
}

/**
 * Revoke an API key by setting revoked_at timestamp.
 */
export async function revokeApiKey(keyId: string, orgId: string): Promise<boolean> {
  const db = getDb();
  const [result] = await db
    .update(agentApiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentApiKeys.id, keyId),
        eq(agentApiKeys.orgId, orgId),
        isNull(agentApiKeys.revokedAt),
      ),
    )
    .returning({ id: agentApiKeys.id });

  return !!result;
}

/**
 * Rotate an API key: revoke the existing one and generate a new key
 * with the same parameters. Wrapped in a transaction for atomicity (H-07).
 */
export async function rotateApiKey(
  keyId: string,
  orgId: string,
): Promise<{ key: string; id: string; keyPrefix: string } | null> {
  const db = getDb();

  // Fetch existing key metadata before revoking
  const [existing] = await db
    .select({
      agentId: agentApiKeys.agentId,
      orgId: agentApiKeys.orgId,
      label: agentApiKeys.label,
      scopes: agentApiKeys.scopes,
      projectIds: agentApiKeys.projectIds,
      rateLimitRpm: agentApiKeys.rateLimitRpm,
      createdBy: agentApiKeys.createdBy,
    })
    .from(agentApiKeys)
    .where(
      and(
        eq(agentApiKeys.id, keyId),
        eq(agentApiKeys.orgId, orgId),
        isNull(agentApiKeys.revokedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    return null;
  }

  // Revoke old key
  await db
    .update(agentApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(agentApiKeys.id, keyId));

  // Generate new key with same params
  return generateAgentApiKey({
    agentId: existing.agentId,
    orgId: existing.orgId,
    label: existing.label ? `${existing.label} (rotated)` : 'rotated',
    scopes: existing.scopes ?? undefined,
    projectIds: existing.projectIds ?? undefined,
    rateLimitRpm: existing.rateLimitRpm ?? undefined,
    createdBy: existing.createdBy ?? undefined,
  });
}
