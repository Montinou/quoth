/**
 * Agent Management MCP Tools — QUOTH-08
 *
 * 7 tools:
 *   - quoth_agent_register      — register agent in agents.registry
 *   - quoth_agent_list          — list agents in org
 *   - quoth_agent_assign        — assign agent to project
 *   - quoth_agent_send_message  — send message via comms
 *   - quoth_agent_inbox         — read agent inbox
 *   - quoth_agent_tasks         — list/claim/complete tasks
 *   - quoth_agent_task_reassign — reassign task to different agent (admin only)
 *
 * All queries run against the `agents` and `comms` schemas via Drizzle ORM.
 */

import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '@/db/connection';
import {
  agentRegistry,
  agentProjects,
  messages,
  tasks,
} from '@/db/schema';
import type { AuthContext } from '@/lib/auth/types';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const AgentRegisterInput = z.object({
  agent_name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens')
    .describe('Unique agent name within the org (lowercase, hyphens allowed)'),
  display_name: z.string().max(128).optional().describe('Human-readable display name'),
  instance: z.string().min(1).max(128).describe('Instance identifier (e.g. hostname)'),
  model: z.string().max(128).optional().describe('LLM model used by the agent'),
  role: z
    .enum(['orchestrator', 'specialist', 'curator', 'admin', 'agent'])
    .default('agent')
    .describe('Agent role'),
  capabilities: z.record(z.unknown()).optional().describe('Capability metadata'),
});

const AgentListInput = z.object({
  status: z
    .enum(['active', 'inactive', 'archived'])
    .default('active')
    .describe('Filter by status'),
  limit: z.number().int().min(1).max(100).default(25),
});

const AgentAssignInput = z.object({
  agent_id: z.string().uuid().describe('Agent UUID'),
  project_id: z.string().uuid().describe('Project UUID'),
  role: z.enum(['owner', 'contributor', 'readonly']).default('contributor'),
});

const SendMessageInput = z.object({
  to_agent_id: z.string().uuid().describe('Recipient agent UUID'),
  message_type: z
    .enum(['message', 'task', 'result', 'alert', 'knowledge', 'curator', 'broadcast'])
    .default('message'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  payload: z.record(z.unknown()).describe('Message payload (JSON object)'),
  reply_to: z.string().uuid().optional().describe('ID of the message being replied to'),
});

const InboxInput = z.object({
  status: z.enum(['pending', 'delivered', 'read']).default('pending'),
  limit: z.number().int().min(1).max(100).default(20),
});

const TaskReassignInput = z.object({
  task_id: z.string().uuid().describe('Task UUID to reassign'),
  new_agent_id: z.string().uuid().describe('UUID of the agent to reassign the task to'),
});

const TasksInput = z.object({
  action: z
    .enum(['list', 'claim', 'complete'])
    .describe("'list' shows tasks, 'claim' starts one, 'complete' finishes one"),
  task_id: z
    .string()
    .uuid()
    .optional()
    .describe('Task UUID (required for claim/complete)'),
  result: z.record(z.unknown()).optional().describe('Result payload (for complete action)'),
  status_filter: z
    .enum(['pending', 'in_progress', 'done', 'failed', 'cancelled'])
    .default('pending')
    .describe('Filter when listing tasks'),
  limit: z.number().int().min(1).max(50).default(20),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes('relation') || err.message.includes('column')) {
      return 'A database error occurred. Please try again later.';
    }
    return err.message;
  }
  return 'An unexpected error occurred.';
}

function requireAgent(authContext: AuthContext): string {
  if (!authContext.isAgent || !authContext.agentId) {
    throw new Error('This tool requires agent authentication (qth_ API key).');
  }
  return authContext.agentId;
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerAgentTools(server: McpServer, authContext: AuthContext) {
  // ── quoth_agent_register ──────────────────────────────────────────────────
  server.registerTool(
    'quoth_agent_register',
    {
      description:
        'Register a new agent in the agents.registry table. ' +
        'Requires admin or owner role. Returns the new agent UUID.',
      inputSchema: AgentRegisterInput,
    },
    async (args) => {
      try {
        if (authContext.role !== 'admin' && authContext.role !== 'owner') {
          return {
            content: [{ type: 'text' as const, text: 'Insufficient permissions. Requires admin or owner role.' }],
            isError: true,
          };
        }

        const input = AgentRegisterInput.parse(args);
        const db = getDb();

        // Generate a signing key for the agent
        const signingKey = randomBytes(32).toString('hex');

        const [agent] = await db
          .insert(agentRegistry)
          .values({
            orgId: authContext.orgId,
            agentName: input.agent_name,
            displayName: input.display_name ?? null,
            instance: input.instance,
            model: input.model ?? null,
            role: input.role,
            capabilities: input.capabilities ?? {},
            signingKey,
            status: 'active',
          })
          .returning({
            id: agentRegistry.id,
            agentName: agentRegistry.agentName,
            createdAt: agentRegistry.createdAt,
          });

        if (!agent) {
          return {
            content: [{ type: 'text' as const, text: 'Failed to register agent.' }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  id: agent.id,
                  agent_name: agent.agentName,
                  created_at: agent.createdAt,
                  signing_key: signingKey,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Registration failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_agent_list ──────────────────────────────────────────────────────
  server.registerTool(
    'quoth_agent_list',
    {
      description: 'List agents registered in the current organization.',
      inputSchema: AgentListInput,
    },
    async (args) => {
      try {
        const { status, limit } = AgentListInput.parse(args);
        const db = getDb();

        const rows = await db
          .select({
            id: agentRegistry.id,
            agentName: agentRegistry.agentName,
            displayName: agentRegistry.displayName,
            instance: agentRegistry.instance,
            model: agentRegistry.model,
            role: agentRegistry.role,
            status: agentRegistry.status,
            lastSeenAt: agentRegistry.lastSeenAt,
            createdAt: agentRegistry.createdAt,
          })
          .from(agentRegistry)
          .where(
            and(
              eq(agentRegistry.orgId, authContext.orgId),
              eq(agentRegistry.status, status),
            ),
          )
          .orderBy(agentRegistry.agentName)
          .limit(limit);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ count: rows.length, agents: rows }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `List failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_agent_assign ────────────────────────────────────────────────────
  server.registerTool(
    'quoth_agent_assign',
    {
      description:
        'Assign an agent to a project. Creates an entry in agents.agent_projects.',
      inputSchema: AgentAssignInput,
    },
    async (args) => {
      try {
        if (authContext.role !== 'admin' && authContext.role !== 'owner') {
          return {
            content: [{ type: 'text' as const, text: 'Insufficient permissions. Requires admin or owner role.' }],
            isError: true,
          };
        }

        const { agent_id, project_id, role } = AgentAssignInput.parse(args);
        const db = getDb();

        await db
          .insert(agentProjects)
          .values({
            agentId: agent_id,
            projectId: project_id,
            role,
            assignedBy: authContext.userId,
          })
          .onConflictDoUpdate({
            target: [agentProjects.agentId, agentProjects.projectId],
            set: {
              role,
              assignedBy: authContext.userId,
              assignedAt: new Date(),
            },
          });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  agent_id,
                  project_id,
                  role,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Assign failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_agent_send_message ──────────────────────────────────────────────
  server.registerTool(
    'quoth_agent_send_message',
    {
      description:
        'Send a direct message from the current agent to another agent. ' +
        'Requires agent authentication (qth_ API key).',
      inputSchema: SendMessageInput,
    },
    async (args) => {
      try {
        const fromAgentId = requireAgent(authContext);
        const input = SendMessageInput.parse(args);
        const db = getDb();

        const [msg] = await db
          .insert(messages)
          .values({
            orgId: authContext.orgId,
            fromAgentId,
            toAgentId: input.to_agent_id,
            messageType: input.message_type,
            priority: input.priority,
            payload: input.payload,
            replyTo: input.reply_to ?? null,
            status: 'pending',
          })
          .returning({
            id: messages.id,
            createdAt: messages.createdAt,
          });

        if (!msg) {
          return {
            content: [{ type: 'text' as const, text: 'Failed to send message.' }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  message_id: msg.id,
                  to: input.to_agent_id,
                  type: input.message_type,
                  priority: input.priority,
                  created_at: msg.createdAt,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Send failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_agent_inbox ─────────────────────────────────────────────────────
  server.registerTool(
    'quoth_agent_inbox',
    {
      description:
        'Read the current agent\'s inbox. Returns messages addressed to this agent. ' +
        'Requires agent authentication.',
      inputSchema: InboxInput,
    },
    async (args) => {
      try {
        const agentId = requireAgent(authContext);
        const { status, limit } = InboxInput.parse(args);
        const db = getDb();

        const rows = await db
          .select({
            id: messages.id,
            fromAgentId: messages.fromAgentId,
            messageType: messages.messageType,
            priority: messages.priority,
            payload: messages.payload,
            status: messages.status,
            replyTo: messages.replyTo,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(
            and(
              eq(messages.toAgentId, agentId),
              eq(messages.status, status),
            ),
          )
          .orderBy(desc(messages.createdAt))
          .limit(limit);

        // Mark fetched messages as delivered (fire-and-forget)
        if (rows.length > 0 && status === 'pending') {
          const messageIds = rows.map((r) => r.id);
          const pgMessageIds = `{${messageIds.join(',')}}`;
          void db
            .update(messages)
            .set({ status: 'delivered', deliveredAt: new Date() })
            .where(
              and(
                eq(messages.toAgentId, agentId),
                eq(messages.status, 'pending'),
                sql`${messages.id} = ANY(${pgMessageIds}::uuid[])`,
              ),
            )
            .then(() => {});
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ count: rows.length, messages: rows }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Inbox failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_agent_tasks ─────────────────────────────────────────────────────
  server.registerTool(
    'quoth_agent_tasks',
    {
      description:
        'List, claim, or complete tasks assigned to the current agent. ' +
        "Actions: 'list' (show tasks), 'claim' (start working), 'complete' (finish with result).",
      inputSchema: TasksInput,
    },
    async (args) => {
      try {
        const agentId = requireAgent(authContext);
        const input = TasksInput.parse(args);
        const db = getDb();

        if (input.action === 'list') {
          const rows = await db
            .select({
              id: tasks.id,
              title: tasks.title,
              description: tasks.description,
              status: tasks.status,
              priority: tasks.priority,
              projectId: tasks.projectId,
              createdBy: tasks.createdBy,
              deadline: tasks.deadline,
              createdAt: tasks.createdAt,
            })
            .from(tasks)
            .where(
              and(
                eq(tasks.assignedTo, agentId),
                eq(tasks.status, input.status_filter),
              ),
            )
            .orderBy(tasks.priority, desc(tasks.createdAt))
            .limit(input.limit);

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ count: rows.length, tasks: rows }, null, 2),
              },
            ],
          };
        }

        if (input.action === 'claim') {
          if (!input.task_id) {
            return {
              content: [{ type: 'text' as const, text: 'task_id is required for claim action.' }],
              isError: true,
            };
          }

          const [updated] = await db
            .update(tasks)
            .set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(tasks.id, input.task_id),
                eq(tasks.assignedTo, agentId),
                eq(tasks.status, 'pending'),
              ),
            )
            .returning({ id: tasks.id, title: tasks.title });

          if (!updated) {
            return {
              content: [
                { type: 'text' as const, text: 'Task not found, already claimed, or not assigned to you.' },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ claimed: true, task_id: updated.id, title: updated.title }, null, 2),
              },
            ],
          };
        }

        if (input.action === 'complete') {
          if (!input.task_id) {
            return {
              content: [{ type: 'text' as const, text: 'task_id is required for complete action.' }],
              isError: true,
            };
          }

          const [updated] = await db
            .update(tasks)
            .set({
              status: 'done',
              result: input.result ?? {},
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(tasks.id, input.task_id),
                eq(tasks.assignedTo, agentId),
                eq(tasks.status, 'in_progress'),
              ),
            )
            .returning({ id: tasks.id, title: tasks.title });

          if (!updated) {
            return {
              content: [
                { type: 'text' as const, text: 'Task not found or not in in_progress state.' },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { completed: true, task_id: updated.id, title: updated.title },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return {
          content: [{ type: 'text' as const, text: `Unknown action: ${input.action}` }],
          isError: true,
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Tasks failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── quoth_agent_task_reassign ──────────────────────────────────────────────
  server.registerTool(
    'quoth_agent_task_reassign',
    {
      description:
        'Reassign a task to a different agent. Resets the task to pending status. ' +
        'Requires admin or owner role.',
      inputSchema: TaskReassignInput,
    },
    async (args) => {
      try {
        if (authContext.role !== 'admin' && authContext.role !== 'owner') {
          return {
            content: [{ type: 'text' as const, text: 'Insufficient permissions. Requires admin or owner role.' }],
            isError: true,
          };
        }

        const input = TaskReassignInput.parse(args);
        const db = getDb();

        const result = await db.execute(
          sql`
            UPDATE comms.tasks
            SET assigned_to = ${input.new_agent_id},
                status = 'pending',
                started_at = NULL,
                updated_at = now()
            WHERE id = ${input.task_id}::uuid
              AND status IN ('pending', 'in_progress')
            RETURNING id, title
          `,
        );

        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Task not found or not in a reassignable state (must be pending or in_progress).',
              },
            ],
            isError: true,
          };
        }

        const row = result.rows[0];
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  reassigned: true,
                  task_id: row.id,
                  title: row.title,
                  new_agent_id: input.new_agent_id,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Reassign failed: ${sanitizeError(err)}` }],
          isError: true,
        };
      }
    },
  );
}
