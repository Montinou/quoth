/**
 * Project MCP Tools — QUOTH-08
 *
 * 3 tools:
 *   - quoth_project_create   — create a new project
 *   - quoth_project_invite   — invite a member to a project
 *   - quoth_token_generate   — generate an agent API key
 *
 * Uses Clerk auth context + agents.api_keys for token generation.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '@/db/connection';
import { projects, projectMembers, agentRegistry } from '@/db/schema';
import { generateAgentApiKey } from '@/lib/auth/agent-keys';
import type { AuthContext } from '@/lib/auth/types';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const ProjectCreateInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens')
    .describe('URL-safe project slug'),
  name: z.string().min(1).max(128).describe('Human-readable project name'),
  description: z.string().max(2000).optional().describe('Project description'),
  is_public: z.boolean().default(false).describe('Whether the project is publicly visible'),
  tier: z.enum(['free', 'pro', 'team', 'enterprise']).default('free'),
});

const ProjectInviteInput = z.object({
  project_id: z.string().uuid().describe('Project UUID'),
  user_id: z.string().uuid().describe('User UUID to invite'),
  role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
});

const TokenGenerateInput = z.object({
  agent_id: z.string().uuid().describe('Agent UUID to generate a key for'),
  label: z.string().max(128).optional().describe('Human-readable label for the key'),
  scopes: z
    .array(z.string())
    .default(['read', 'write'])
    .describe('Permission scopes'),
  project_ids: z
    .array(z.string().uuid())
    .optional()
    .describe('Restrict key to specific projects (omit for all org projects)'),
  rate_limit_rpm: z.number().int().min(1).max(10000).default(60).describe('Rate limit (requests per minute)'),
  expires_days: z.number().int().min(1).max(365).optional().describe('Key expiry in days'),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes('relation') || err.message.includes('column') || err.message.includes('duplicate')) {
      return 'A database error occurred. The resource may already exist.';
    }
    return err.message;
  }
  return 'An unexpected error occurred.';
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerProjectTools(server: McpServer, authContext: AuthContext) {
  // ── quoth_project_create ──────────────────────────────────────────────────
  server.registerTool(
    'quoth_project_create',
    {
      description:
        'Create a new project within the current organization. ' +
        'Requires admin or owner role. The creating user is added as project admin.',
      inputSchema: ProjectCreateInput,
    },
    async (args) => {
      try {
        if (authContext.role !== 'admin' && authContext.role !== 'owner') {
          return {
            content: [{ type: 'text' as const, text: 'Insufficient permissions. Requires admin or owner role.' }],
            isError: true,
          };
        }

        const input = ProjectCreateInput.parse(args);
        const db = getDb();

        const [project] = await db
          .insert(projects)
          .values({
            orgId: authContext.orgId,
            slug: input.slug,
            name: input.name,
            description: input.description ?? null,
            isPublic: input.is_public,
            tier: input.tier,
          })
          .returning({
            id: projects.id,
            slug: projects.slug,
            name: projects.name,
            createdAt: projects.createdAt,
          });

        if (!project) {
          return {
            content: [{ type: 'text' as const, text: 'Failed to create project.' }],
            isError: true,
          };
        }

        // Add creator as project admin (only for human users)
        if (!authContext.isAgent) {
          await db.insert(projectMembers).values({
            projectId: project.id,
            userId: authContext.userId,
            role: 'admin',
          });
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  id: project.id,
                  slug: project.slug,
                  name: project.name,
                  created_at: project.createdAt,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Create failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_project_invite ──────────────────────────────────────────────────
  server.registerTool(
    'quoth_project_invite',
    {
      description:
        'Invite a user to a project with a specific role. ' +
        'Requires admin or owner role on the project.',
      inputSchema: ProjectInviteInput,
    },
    async (args) => {
      try {
        if (authContext.role !== 'admin' && authContext.role !== 'owner') {
          return {
            content: [{ type: 'text' as const, text: 'Insufficient permissions. Requires admin or owner role.' }],
            isError: true,
          };
        }

        const { project_id, user_id, role } = ProjectInviteInput.parse(args);
        const db = getDb();

        // Verify project belongs to the org
        const [proj] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, project_id),
              eq(projects.orgId, authContext.orgId),
            ),
          )
          .limit(1);

        if (!proj) {
          return {
            content: [{ type: 'text' as const, text: 'Project not found in your organization.' }],
            isError: true,
          };
        }

        await db
          .insert(projectMembers)
          .values({
            projectId: project_id,
            userId: user_id,
            role,
          })
          .onConflictDoUpdate({
            target: [projectMembers.projectId, projectMembers.userId],
            set: { role },
          });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { success: true, project_id, user_id, role },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Invite failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_token_generate ──────────────────────────────────────────────────
  server.registerTool(
    'quoth_token_generate',
    {
      description:
        'Generate an API key (qth_ prefix) for an agent. ' +
        'The raw key is returned once and cannot be retrieved later. ' +
        'Requires admin or owner role.',
      inputSchema: TokenGenerateInput,
    },
    async (args) => {
      try {
        if (authContext.role !== 'admin' && authContext.role !== 'owner') {
          return {
            content: [{ type: 'text' as const, text: 'Insufficient permissions. Requires admin or owner role.' }],
            isError: true,
          };
        }

        const input = TokenGenerateInput.parse(args);
        const db = getDb();

        // Verify agent belongs to org
        const [agent] = await db
          .select({ id: agentRegistry.id, agentName: agentRegistry.agentName })
          .from(agentRegistry)
          .where(
            and(
              eq(agentRegistry.id, input.agent_id),
              eq(agentRegistry.orgId, authContext.orgId),
            ),
          )
          .limit(1);

        if (!agent) {
          return {
            content: [{ type: 'text' as const, text: 'Agent not found in your organization.' }],
            isError: true,
          };
        }

        const result = await generateAgentApiKey({
          agentId: input.agent_id,
          orgId: authContext.orgId,
          label: input.label,
          scopes: input.scopes,
          projectIds: input.project_ids,
          rateLimitRpm: input.rate_limit_rpm,
          expiresDays: input.expires_days,
          createdBy: authContext.isAgent ? undefined : authContext.userId,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  key: result.key,
                  key_id: result.id,
                  key_prefix: result.keyPrefix,
                  agent_id: input.agent_id,
                  agent_name: agent.agentName,
                  scopes: input.scopes,
                  warning:
                    'Store this key securely. It cannot be retrieved after this response.',
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Token generation failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );
}
