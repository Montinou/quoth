/**
 * Quoth v3.0 Agent CRUD MCP Tools
 * Register, update, remove, list agents in an organization
 * Assign/unassign agents to projects
 * Agent-to-agent messaging and task management
 *
 * Organization is derived from the authenticated project's organization_id
 */

import { z } from 'zod';
import { createHash, createHmac } from 'crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/mcp-auth';
import { supabase } from '../supabase';
import { logActivity } from './activity';

/**
 * Generate HMAC-SHA256 signature for agent messages.
 * Returns first 16 hex characters of the HMAC digest.
 */
export async function generateSignature(agentId: string, messageText: string): Promise<string> {
  const { data } = await supabase
    .from('agents')
    .select('signing_key')
    .eq('id', agentId)
    .single();

  if (!data?.signing_key) {
    throw new Error(`Agent ${agentId} has no signing key`);
  }

  // HMAC-SHA256 of message content using agent's signing key
  const hmac = createHmac('sha256', data.signing_key);
  hmac.update(messageText);
  return hmac.digest('hex').substring(0, 16);
}

/**
 * Verify HMAC signature for agent messages.
 * Returns true if the provided signature matches the expected signature.
 */
export async function verifySignature(agentId: string, messageText: string, signature: string): Promise<boolean> {
  const expected = await generateSignature(agentId, messageText);
  return expected === signature;
}

/**
 * Derive organization_id from the authenticated project
 * All agent operations are scoped to the organization
 */
export async function getOrganizationId(projectId: string): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .single();

  if (error || !data?.organization_id) {
    throw new Error(
      'Project is not linked to an organization. Run the v3.0 migration first.'
    );
  }

  return data.organization_id;
}

/**
 * Register all agent management tools on the MCP server
 */
export function registerAgentTools(
  server: McpServer,
  authContext: AuthContext
) {
  // ─── Tool 1: quoth_agent_register ───────────────────────────
  server.registerTool(
    'quoth_agent_register',
    {
      title: 'Register Agent',
      description:
        'Register a new agent in your organization. Agents are org-scoped and can optionally be assigned to projects.',
      inputSchema: {
        agent_name: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .describe(
            'Unique agent name within org (lowercase, hyphens allowed)'
          ),
        display_name: z
          .string()
          .optional()
          .describe('Human-readable name with emoji, e.g. "Main Orchestrator 🌙"'),
        instance: z
          .string()
          .describe('Instance where agent runs: aws, mac, montino, etc.'),
        model: z
          .string()
          .optional()
          .describe('AI model identifier, e.g. "anthropic/claude-opus-4"'),
        role: z
          .string()
          .optional()
          .describe(
            'Agent role: orchestrator, specialist, curator, admin'
          ),
        capabilities: z
          .record(z.any())
          .optional()
          .describe('Capabilities JSON, e.g. {"gpu": true}'),
        metadata: z
          .record(z.any())
          .optional()
          .describe('Additional metadata'),
        project_slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .optional()
          .describe('Optional project slug. If provided and does not exist, will auto-create the project and assign agent as owner.'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const {
        agent_name,
        display_name,
        instance,
        model,
        role,
        capabilities,
        metadata,
        project_slug,
      } = args;

      const { data, error } = await supabase
        .from('agents')
        .insert({
          organization_id: organizationId,
          agent_name,
          display_name,
          instance,
          model,
          role,
          capabilities,
          metadata,
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to register agent: ${error.message}`);
      }

      let projectInfo = '';

      // Auto-create and assign project if project_slug provided
      if (project_slug) {
        // Check if project exists
        const { data: existingProject } = await supabase
          .from('projects')
          .select('id, slug')
          .eq('organization_id', organizationId)
          .eq('slug', project_slug)
          .single();

        let projectId: string;

        if (existingProject) {
          // Project exists, just assign
          projectId = existingProject.id;
          projectInfo = `\n**Project:** Assigned to existing project \`${project_slug}\``;
        } else {
          // Project doesn't exist, create it
          const { data: newProject, error: projectError } = await supabase
            .from('projects')
            .insert({
              slug: project_slug,
              github_repo: '',
              is_public: false,
              organization_id: organizationId,
              owner_id: authContext.user_id,
              created_by: authContext.user_id,
            })
            .select()
            .single();

          if (projectError) {
            throw new Error(`Failed to create project: ${projectError.message}`);
          }

          projectId = newProject.id;
          projectInfo = `\n**Project:** Auto-created and assigned to new project \`${project_slug}\` ✨`;
        }

        // Assign agent to project as owner
        const { error: assignError } = await supabase
          .from('agent_projects')
          .insert({
            agent_id: data.id,
            project_id: projectId,
            role: 'owner',
            assigned_by: authContext.user_id,
          });

        if (assignError) {
          throw new Error(`Failed to assign agent to project: ${assignError.message}`);
        }
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_register',
        query: agent_name,
        toolName: 'quoth_agent_register',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Agent registered!

**Agent ID:** ${data.id}
**Name:** ${agent_name}
**Display Name:** ${display_name || agent_name}
**Instance:** ${instance}
**Role:** ${role || 'unspecified'}${projectInfo}

This agent can now send/receive messages and create shared knowledge.`,
          },
        ],
      };
    }
  );

  // ─── Tool 2: quoth_agent_update ─────────────────────────────
  server.registerTool(
    'quoth_agent_update',
    {
      title: 'Update Agent',
      description: 'Update agent profile, status, or metadata.',
      inputSchema: {
        agent_id: z
          .string()
          .uuid()
          .optional()
          .describe('Agent UUID (or use agent_name)'),
        agent_name: z
          .string()
          .optional()
          .describe('Or specify by name within org'),
        display_name: z.string().optional(),
        status: z
          .enum(['active', 'inactive', 'archived'])
          .optional(),
        model: z.string().optional(),
        role: z.string().optional(),
        capabilities: z.record(z.any()).optional(),
        metadata: z.record(z.any()).optional(),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { agent_id, agent_name, ...updates } = args;

      if (!agent_id && !agent_name) {
        throw new Error('Must provide agent_id or agent_name');
      }

      // Remove undefined values
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );

      if (Object.keys(cleanUpdates).length === 0) {
        throw new Error('No updates provided');
      }

      let query = supabase
        .from('agents')
        .update(cleanUpdates)
        .eq('organization_id', organizationId);

      if (agent_id) {
        query = query.eq('id', agent_id);
      } else {
        query = query.eq('agent_name', agent_name!);
      }

      const { data, error } = await query.select().single();

      if (error) {
        throw new Error(`Failed to update agent: ${error.message}`);
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_update',
        query: agent_name || agent_id || '',
        toolName: 'quoth_agent_update',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Agent updated!

**Agent:** ${data.agent_name}
**Updated fields:** ${Object.keys(cleanUpdates).join(', ')}`,
          },
        ],
      };
    }
  );

  // ─── Tool 3: quoth_agent_remove ─────────────────────────────
  server.registerTool(
    'quoth_agent_remove',
    {
      title: 'Remove Agent',
      description:
        'Deactivate (archive) or hard-delete an agent. Default: archive.',
      inputSchema: {
        agent_id: z.string().uuid().optional(),
        agent_name: z.string().optional(),
        hard_delete: z
          .boolean()
          .default(false)
          .describe('If true, permanently delete; if false, set status=archived'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { agent_id, agent_name, hard_delete } = args;

      if (!agent_id && !agent_name) {
        throw new Error('Must provide agent_id or agent_name');
      }

      let query: any;
      if (hard_delete) {
        query = supabase.from('agents').delete();
      } else {
        query = supabase.from('agents').update({ status: 'archived' });
      }

      query = query.eq('organization_id', organizationId);

      if (agent_id) {
        query = query.eq('id', agent_id);
      } else {
        query = query.eq('agent_name', agent_name);
      }

      const { data, error } = await query.select().single();

      if (error) {
        throw new Error(`Failed to remove agent: ${error.message}`);
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_remove',
        query: agent_name || agent_id || '',
        toolName: 'quoth_agent_remove',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: hard_delete
              ? `✅ Agent permanently deleted: ${data.agent_name}`
              : `✅ Agent archived: ${data.agent_name}`,
          },
        ],
      };
    }
  );

  // ─── Tool 4: quoth_agent_list ───────────────────────────────
  server.registerTool(
    'quoth_agent_list',
    {
      title: 'List Agents',
      description:
        'List all agents in your organization. Filter by status, instance, or project.',
      inputSchema: {
        status: z
          .enum(['active', 'inactive', 'archived', 'all'])
          .optional()
          .default('active'),
        instance: z
          .string()
          .optional()
          .describe('Filter by instance (aws, mac, montino)'),
        project_id: z
          .string()
          .uuid()
          .optional()
          .describe('Filter by project assignment'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { status, instance, project_id } = args;

      let query = supabase
        .from('agents')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      if (instance) {
        query = query.eq('instance', instance);
      }

      // Filter by project assignment if specified
      if (project_id) {
        const { data: assignments } = await supabase
          .from('agent_projects')
          .select('agent_id')
          .eq('project_id', project_id);

        const agentIds = (assignments || []).map(
          (a: { agent_id: string }) => a.agent_id
        );
        if (agentIds.length > 0) {
          query = query.in('id', agentIds);
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No agents assigned to this project.',
              },
            ],
          };
        }
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to list agents: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No agents found matching your criteria.',
            },
          ],
        };
      }

      const formatted = data
        .map(
          (a) => `- **${a.display_name || a.agent_name}** (\`${a.agent_name}\`)
  - ID: \`${a.id}\`
  - Instance: ${a.instance}
  - Role: ${a.role || 'unspecified'}
  - Model: ${a.model || 'unspecified'}
  - Status: ${a.status}
  - Last seen: ${a.last_seen_at || 'never'}`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `# Agents in Organization

${formatted}

**Total:** ${data.length}`,
          },
        ],
      };
    }
  );

  // ─── Tool 5: quoth_agent_assign_project ─────────────────────
  server.registerTool(
    'quoth_agent_assign_project',
    {
      title: 'Assign Agent to Project',
      description:
        'Assign an agent to work on a specific project (optional many-to-many).',
      inputSchema: {
        agent_id: z.string().uuid().optional(),
        agent_name: z
          .string()
          .optional()
          .describe('Or specify by name'),
        project_id: z
          .string()
          .uuid()
          .describe('Project to assign agent to'),
        role: z
          .enum(['owner', 'contributor', 'readonly'])
          .optional()
          .default('contributor'),
        assigned_by: z
          .string()
          .optional()
          .describe('Who is making this assignment'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { agent_id, agent_name, project_id, role, assigned_by } = args;

      if (!agent_id && !agent_name) {
        throw new Error('Must provide agent_id or agent_name');
      }

      // Lookup agent if name provided
      let targetAgentId = agent_id;
      if (!targetAgentId) {
        const { data: agent, error } = await supabase
          .from('agents')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('agent_name', agent_name!)
          .single();

        if (error) {
          throw new Error(`Agent "${agent_name}" not found`);
        }
        targetAgentId = agent.id;
      }

      const { error } = await supabase.from('agent_projects').upsert({
        agent_id: targetAgentId,
        project_id,
        role: role || 'contributor',
        assigned_by: assigned_by || authContext.user_id,
      });

      if (error) {
        throw new Error(
          `Failed to assign agent to project: ${error.message}`
        );
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_assign_project',
        query: agent_name || agent_id || '',
        toolName: 'quoth_agent_assign_project',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Agent assigned to project!

**Agent:** ${agent_name || targetAgentId}
**Project:** ${project_id}
**Role:** ${role || 'contributor'}

The agent can now work on this project while retaining org-wide access.`,
          },
        ],
      };
    }
  );

  // ─── Tool 6: quoth_agent_unassign_project ───────────────────
  server.registerTool(
    'quoth_agent_unassign_project',
    {
      title: 'Unassign Agent from Project',
      description:
        'Remove an agent assignment from a project. Agent retains org-wide access.',
      inputSchema: {
        agent_id: z.string().uuid().optional(),
        agent_name: z.string().optional(),
        project_id: z
          .string()
          .uuid()
          .describe('Project to unassign from'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { agent_id, agent_name, project_id } = args;

      if (!agent_id && !agent_name) {
        throw new Error('Must provide agent_id or agent_name');
      }

      // Lookup agent if name provided
      let targetAgentId = agent_id;
      if (!targetAgentId) {
        const { data: agent, error } = await supabase
          .from('agents')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('agent_name', agent_name!)
          .single();

        if (error) {
          throw new Error(`Agent "${agent_name}" not found`);
        }
        targetAgentId = agent.id;
      }

      const { error } = await supabase
        .from('agent_projects')
        .delete()
        .eq('agent_id', targetAgentId!)
        .eq('project_id', project_id);

      if (error) {
        throw new Error(
          `Failed to unassign agent from project: ${error.message}`
        );
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_unassign_project',
        query: agent_name || agent_id || '',
        toolName: 'quoth_agent_unassign_project',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Agent unassigned from project!

**Agent:** ${agent_name || targetAgentId}
**Project:** ${project_id}

The agent still has access to org-wide knowledge and messaging.`,
          },
        ],
      };
    }
  );

  // ─── Tool 7: quoth_agent_message ────────────────────────────
  server.registerTool(
    'quoth_agent_message',
    {
      title: 'Send Message to Agent',
      description:
        'Send a targeted message to a specific agent in your organization',
      inputSchema: {
        to: z
          .string()
          .describe('Target agent name or UUID'),
        message: z
          .string()
          .describe('Message content'),
        type: z
          .enum(['message', 'task', 'result', 'alert', 'knowledge', 'curator'])
          .default('message')
          .describe('Message type'),
        priority: z
          .enum(['low', 'normal', 'high', 'urgent'])
          .default('normal')
          .describe('Message priority'),
        channel: z
          .string()
          .optional()
          .describe('Optional channel/topic'),
        reply_to: z
          .string()
          .uuid()
          .optional()
          .describe('Message ID to reply to'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { to, message, type, priority, channel, reply_to } = args;

      // Get current agent (from user_id in auth context or lookup by project)
      // Assuming user_id maps to an agent, or fallback to a "human" agent
      let fromAgentId: string;

      // Try to find agent by user_id or create a default sender
      const { data: fromAgent, error: fromError } = await supabase
        .from('agents')
        .select('id')
        .eq('organization_id', organizationId)
        .or(
          `metadata->>user_id.eq.${authContext.user_id},agent_name.eq.human`
        )
        .limit(1)
        .single();

      if (fromError || !fromAgent) {
        // Fallback: use first active agent in org (or create human agent)
        const { data: fallback } = await supabase
          .from('agents')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (!fallback) {
          throw new Error(
            'No sender agent found. Register an agent first.'
          );
        }
        fromAgentId = fallback.id;
      } else {
        fromAgentId = fromAgent.id;
      }

      // Lookup target agent (by name or UUID)
      let toAgentId: string;

      if (to.match(/^[0-9a-f-]{36}$/i)) {
        // Already a UUID
        toAgentId = to;
      } else {
        // Lookup by name
        const { data: toAgent, error: toError } = await supabase
          .from('agents')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('agent_name', to)
          .eq('status', 'active')
          .single();

        if (toError) {
          throw new Error(`Agent "${to}" not found or inactive`);
        }
        toAgentId = toAgent.id;
      }

      // Generate created_at timestamp for signature
      const createdAt = new Date().toISOString();
      const payload = { message };
      
      // Generate HMAC signature: from:to:payload:timestamp
      const messageText = `${fromAgentId}:${toAgentId}:${JSON.stringify(payload)}:${createdAt}`;
      const signature = await generateSignature(fromAgentId, messageText);

      // Insert message
      const { data, error } = await supabase
        .from('agent_messages')
        .insert({
          organization_id: organizationId,
          from_agent_id: fromAgentId,
          to_agent_id: toAgentId,
          type: type || 'message',
          payload,
          priority: priority || 'normal',
          channel,
          reply_to,
          signature,
          status: 'pending',
          created_at: createdAt,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to send message: ${error.message}`);
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_message_sent',
        query: to,
        toolName: 'quoth_agent_message',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Message sent to ${to}!

**Message ID:** ${data.id}
**Type:** ${type || 'message'}
**Priority:** ${priority || 'normal'}
${channel ? `**Channel:** ${channel}\n` : ''}**Status:** Pending delivery

The recipient agent will receive this via Realtime push.`,
          },
        ],
      };
    }
  );

  // ─── Tool 8: quoth_agent_inbox ──────────────────────────────
  server.registerTool(
    'quoth_agent_inbox',
    {
      title: 'Read Agent Inbox',
      description:
        'Retrieve messages sent to agents in your organization',
      inputSchema: {
        agent_id: z
          .string()
          .uuid()
          .optional()
          .describe('Agent UUID (or use agent_name)'),
        agent_name: z
          .string()
          .optional()
          .describe('Or specify by name'),
        limit: z
          .number()
          .default(10)
          .describe('Max messages to retrieve'),
        status: z
          .enum(['pending', 'delivered', 'read', 'failed', 'all'])
          .default('pending')
          .describe('Filter by message status'),
        mark_read: z
          .boolean()
          .default(false)
          .describe('Mark retrieved messages as read'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { agent_id, agent_name, limit, status, mark_read } = args;

      if (!agent_id && !agent_name) {
        throw new Error('Must provide agent_id or agent_name');
      }

      // Lookup target agent
      let targetAgentId = agent_id;
      if (!targetAgentId) {
        const { data: agent, error } = await supabase
          .from('agents')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('agent_name', agent_name!)
          .single();

        if (error) {
          throw new Error(`Agent "${agent_name}" not found`);
        }
        targetAgentId = agent.id;
      }

      // Query messages
      let query = supabase
        .from('agent_messages')
        .select(
          `
          *,
          from_agent:agents!from_agent_id(agent_name, display_name, instance)
        `
        )
        .eq('to_agent_id', targetAgentId)
        .order('created_at', { ascending: false })
        .limit(limit || 10);

      if (status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: messages, error } = await query;

      if (error) {
        throw new Error(`Failed to retrieve inbox: ${error.message}`);
      }

      if (!messages || messages.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `📭 Inbox is empty (status: ${status || 'all'})`,
            },
          ],
        };
      }

      // Optionally mark as read
      if (mark_read) {
        const messageIds = messages.map((m) => m.id);
        await supabase
          .from('agent_messages')
          .update({
            status: 'read',
            read_at: new Date().toISOString(),
          })
          .in('id', messageIds);
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_inbox_read',
        query: agent_name || agent_id || '',
        toolName: 'quoth_agent_inbox',
      });

      // Format messages
      const formatted = messages
        .map((m: any) => {
          const from =
            m.from_agent?.display_name ||
            m.from_agent?.agent_name ||
            'unknown';
          const instance = m.from_agent?.instance || '';
          const msg = m.payload?.message || JSON.stringify(m.payload);

          return `---
**From:** ${from}${instance ? ` @ ${instance}` : ''}
**Type:** ${m.type} | **Priority:** ${m.priority}
**Status:** ${m.status}
**Created:** ${m.created_at}
${m.channel ? `**Channel:** ${m.channel}\n` : ''}
**Message:**
${msg}

*ID: ${m.id}*`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `📬 Inbox for ${agent_name || targetAgentId}

**Total:** ${messages.length} message${messages.length !== 1 ? 's' : ''}
${mark_read ? '✅ Marked as read\n' : ''}
${formatted}`,
          },
        ],
      };
    }
  );

  // ─── Tool 9: quoth_task_create ──────────────────────────────
  server.registerTool(
    'quoth_task_create',
    {
      title: 'Create Agent Task',
      description:
        'Create a structured task for an agent in your organization',
      inputSchema: {
        assigned_to: z
          .string()
          .describe('Agent name or UUID to assign task to'),
        title: z
          .string()
          .describe('Task title'),
        description: z
          .string()
          .optional()
          .describe('Detailed task description'),
        priority: z
          .number()
          .default(5)
          .describe('Priority (1=highest, 10=lowest). Default 5.'),
        deadline: z
          .string()
          .optional()
          .describe('Deadline (ISO 8601 timestamp)'),
        payload: z
          .record(z.any())
          .optional()
          .describe('Additional task data as JSON'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { assigned_to, title, description, priority, deadline, payload } =
        args;

      // Get creator agent (same logic as message sender)
      const { data: fromAgent } = await supabase
        .from('agents')
        .select('id')
        .eq('organization_id', organizationId)
        .or(
          `metadata->>user_id.eq.${authContext.user_id},agent_name.eq.human`
        )
        .limit(1)
        .single();

      const createdBy =
        fromAgent?.id ||
        (
          await supabase
            .from('agents')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('status', 'active')
            .limit(1)
            .single()
        ).data?.id;

      if (!createdBy) {
        throw new Error('No creator agent found');
      }

      // Lookup assigned agent
      let assignedToId: string;

      if (assigned_to.match(/^[0-9a-f-]{36}$/i)) {
        assignedToId = assigned_to;
      } else {
        const { data: agent, error } = await supabase
          .from('agents')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('agent_name', assigned_to)
          .eq('status', 'active')
          .single();

        if (error) {
          throw new Error(`Agent "${assigned_to}" not found or inactive`);
        }
        assignedToId = agent.id;
      }

      // Generate created_at timestamp for signature
      const createdAt = new Date().toISOString();
      
      // Generate HMAC signature: created_by:assigned_to:title:payload:timestamp
      const taskText = `${createdBy}:${assignedToId}:${title}:${JSON.stringify(payload || {})}:${createdAt}`;
      const signature = await generateSignature(createdBy, taskText);

      // Insert task
      const { data, error } = await supabase
        .from('agent_tasks')
        .insert({
          organization_id: organizationId,
          assigned_to: assignedToId,
          created_by: createdBy,
          title,
          description,
          priority: priority || 5,
          deadline: deadline || null,
          payload,
          status: 'pending',
          signature,
          created_at: createdAt,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create task: ${error.message}`);
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_task_created',
        query: assigned_to,
        toolName: 'quoth_task_create',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Task created!

**Task ID:** ${data.id}
**Assigned to:** ${assigned_to}
**Title:** ${title}
**Priority:** ${priority || 5}
${deadline ? `**Deadline:** ${deadline}\n` : ''}**Status:** pending

The assigned agent can view this task in their task queue.`,
          },
        ],
      };
    }
  );

  // ─── Tool 10: quoth_task_update ─────────────────────────────
  server.registerTool(
    'quoth_task_update',
    {
      title: 'Update Agent Task',
      description:
        'Update task status, result, or other fields',
      inputSchema: {
        task_id: z
          .string()
          .uuid()
          .describe('Task UUID'),
        status: z
          .enum(['pending', 'in_progress', 'done', 'failed', 'cancelled'])
          .optional()
          .describe('New status'),
        result: z
          .record(z.any())
          .optional()
          .describe('Task result data (JSON)'),
        priority: z
          .number()
          .optional()
          .describe('Update priority'),
        deadline: z
          .string()
          .optional()
          .describe('Update deadline'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { task_id, status, result, priority, deadline } = args;

      const updates: any = {};

      if (status) {
        updates.status = status;

        // Auto-set timestamps based on status
        if (status === 'in_progress' && !updates.started_at) {
          updates.started_at = new Date().toISOString();
        }
        if (
          (status === 'done' || status === 'failed' || status === 'cancelled') &&
          !updates.completed_at
        ) {
          updates.completed_at = new Date().toISOString();
        }
      }

      if (result !== undefined) updates.result = result;
      if (priority !== undefined) updates.priority = priority;
      if (deadline !== undefined) updates.deadline = deadline;

      if (Object.keys(updates).length === 0) {
        throw new Error('No updates provided');
      }

      const { data, error } = await supabase
        .from('agent_tasks')
        .update(updates)
        .eq('id', task_id)
        .eq('organization_id', organizationId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update task: ${error.message}`);
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_task_updated',
        query: task_id,
        toolName: 'quoth_task_update',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Task updated!

**Task ID:** ${task_id}
**New Status:** ${data.status}
**Updated fields:** ${Object.keys(updates).join(', ')}

${data.completed_at ? `✅ Completed at: ${data.completed_at}` : ''}`,
          },
        ],
      };
    }
  );
}
