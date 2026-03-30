/**
 * Clerk-based AuthContext for Quoth
 * Used by both human users (Clerk JWT) and agents (API key)
 */

export interface AuthContext {
  /** For humans: Clerk user ID. For agents: agent UUID from agents.registry. */
  userId: string;
  /** Clerk user ID (only set for human users, null for agents). */
  clerkUserId: string | null;
  orgId: string;
  projectId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  isAgent: boolean;
  agentId?: string;
  scopes?: string[];
}

/**
 * Raw claims extracted from a Clerk JWT template (quoth-mcp)
 * See OPTIMIZATION_PLAN.md section 3.3 for template config
 */
export interface ClerkJwtClaims {
  org_id?: string;
  org_slug?: string;
  org_role?: string;
  user_id?: string;
  email?: string;
  project_id?: string;
  tier?: string;
  permissions?: string[];
}

/**
 * Result of verifying an agent API key against agents.api_keys
 */
export interface AgentKeyPayload {
  agent_id: string;
  org_id: string;
  scopes: string[];
  project_ids: string[] | null;
  rate_limit_rpm: number;
}
