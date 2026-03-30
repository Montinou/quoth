/**
 * Shared utilities for the Quoth communication bus.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db/connection";

/**
 * Verify that an agent has access to a given project.
 * Org-level resources (projectId is null) are unrestricted.
 * Throws if the agent is not a member of the project.
 */
export async function verifyProjectAccess(
  agentId: string,
  projectId: string | null,
): Promise<void> {
  if (!projectId) return; // org-level, no restriction

  const db = getDb();
  const result = await db.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM agents.agent_projects
      WHERE agent_id = ${agentId} AND project_id = ${projectId}
    ) as has_access
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row?.has_access) {
    throw new Error("Agent does not have access to this project");
  }
}
