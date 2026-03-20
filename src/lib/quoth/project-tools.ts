/**
 * Quoth v3.0 Project Provisioning MCP Tools
 * Token generation + one-shot agent provisioning
 * Enables full agent autonomy — no dashboard needed
 * 
 * Note: quoth_project_create, quoth_project_list, quoth_project_read,
 * quoth_project_update, quoth_project_delete are registered in tools.ts
 */

import { z } from 'zod';
import crypto from 'crypto';
import { SignJWT } from 'jose';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/mcp-auth';
import { supabase } from '../supabase';
import { logActivity } from './activity';
import { getOrganizationId } from './agent-tools';

/**
 * Register provisioning tools on the MCP server
 */
export function registerProjectTools(
  server: McpServer,
  authContext: AuthContext
) {
  // ─── Tool 1: quoth_token_generate ───────────────────────────
  server.registerTool(
    'quoth_token_generate',
    {
      title: 'Generate MCP Token',
      description:
        'Generate a JWT MCP token for a project. The token can be used by agents ' +
        'to authenticate with the Quoth MCP server. Requires admin role.',
      inputSchema: {
        project_id: z
          .string()
          .uuid()
          .optional()
          .describe('Project UUID. If omitted, uses project_slug.'),
        project_slug: z
          .string()
          .optional()
          .describe('Project slug (alternative to project_id)'),
        label: z
          .string()
          .describe('Token label, e.g. "agent-deployer"'),
        expires_days: z
          .number()
          .default(90)
          .describe('Token expiration in days (default 90)'),
      },
    },
    async (args) => {
      const { project_id, project_slug, label, expires_days } = args;

      if (!project_id && !project_slug) {
        throw new Error('Must provide project_id or project_slug');
      }

      let targetProjectId = project_id;
      if (!targetProjectId && project_slug) {
        const organizationId = await getOrganizationId(authContext.project_id);
        const { data: project, error } = await supabase
          .from('projects')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('slug', project_slug)
          .single();

        if (error || !project) {
          throw new Error(`Project "${project_slug}" not found`);
        }
        targetProjectId = project.id;
      }

      if (authContext.role !== 'admin') {
        throw new Error('Only admins can generate tokens');
      }

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new Error('JWT_SECRET not configured on server');
      }

      const jti = crypto.randomUUID();
      const secret = new TextEncoder().encode(jwtSecret);
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = (expires_days || 90) * 24 * 60 * 60;

      const token = await new SignJWT({
        project_id: targetProjectId,
        user_id: authContext.user_id,
        role: 'admin',
        label: label.trim(),
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev')
        .setSubject(targetProjectId!)
        .setAudience('mcp-server')
        .setIssuedAt(now)
        .setExpirationTime(now + expiresIn)
        .setJti(jti)
        .sign(secret);

      const keyHash = crypto.createHash('sha256').update(token).digest('hex');

      const { error: insertError } = await supabase
        .from('project_api_keys')
        .insert({
          id: jti,
          project_id: targetProjectId,
          key_hash: keyHash,
          key_prefix: token.substring(0, 12) + '...',
          label: label.trim(),
          expires_at: new Date((now + expiresIn) * 1000).toISOString(),
        });

      if (insertError) {
        throw new Error(`Failed to store token: ${insertError.message}`);
      }

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'token_generate',
        query: label,
        toolName: 'quoth_token_generate',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ MCP Token generated!

**Label:** ${label}
**Project:** ${targetProjectId}
**Expires:** ${expires_days || 90} days

**Token (save — shown once):**
\`\`\`
${token}
\`\`\`

**mcporter config:**
\`\`\`json
{
  "mcpServers": {
    "quoth": {
      "type": "http",
      "url": "https://quoth.triqual.dev/api/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
\`\`\``,
          },
        ],
      };
    }
  );

  // ─── Tool 2: quoth_project_provision_agent ──────────────────
  server.registerTool(
    'quoth_project_provision_agent',
    {
      title: 'Provision Agent (Full)',
      description:
        'One-shot: create project + register agent + generate token. ' +
        'Returns everything needed to configure mcporter for a new agent. ' +
        'If project/agent already exist, reuses them.',
      inputSchema: {
        agent_name: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .describe('Agent name (lowercase, hyphens). e.g. "deployer"'),
        project_slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .describe('Project slug. e.g. "deployer-verticals"'),
        display_name: z
          .string()
          .optional()
          .describe('Human-readable name. e.g. "Deployer"'),
        instance: z
          .string()
          .describe('Instance: aws, montino, mac'),
        model: z
          .string()
          .optional()
          .describe('Model. e.g. "anthropic/claude-sonnet-4"'),
        role: z
          .string()
          .optional()
          .describe('Role: orchestrator, specialist, curator'),
        token_label: z
          .string()
          .optional()
          .describe('Token label. Defaults to "agent-{agent_name}"'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const {
        agent_name,
        project_slug,
        display_name,
        instance,
        model,
        role,
        token_label,
      } = args;

      // 1. Create or find project
      let projectId: string;
      const { data: existingProject } = await supabase
        .from('projects')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('slug', project_slug)
        .single();

      if (existingProject) {
        projectId = existingProject.id;
      } else {
        const { data: newProject, error } = await supabase
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

        if (error) throw new Error(`Project creation failed: ${error.message}`);
        projectId = newProject.id;

        await supabase.from('project_members').insert({
          project_id: projectId,
          user_id: authContext.user_id,
          role: 'admin',
        });
      }

      // 2. Register or find agent
      let agentId: string;
      const { data: existingAgent } = await supabase
        .from('agents')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('agent_name', agent_name)
        .single();

      if (existingAgent) {
        agentId = existingAgent.id;
      } else {
        const { data: newAgent, error } = await supabase
          .from('agents')
          .insert({
            organization_id: organizationId,
            agent_name,
            display_name: display_name || agent_name,
            instance,
            model,
            role,
            status: 'active',
          })
          .select()
          .single();

        if (error) throw new Error(`Agent registration failed: ${error.message}`);
        agentId = newAgent.id;
      }

      // 3. Assign agent to project
      await supabase.from('agent_projects').upsert({
        agent_id: agentId,
        project_id: projectId,
        role: 'owner',
        assigned_by: authContext.user_id,
      });

      // 4. Generate token
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) throw new Error('JWT_SECRET not configured');

      const jti = crypto.randomUUID();
      const secret = new TextEncoder().encode(jwtSecret);
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 90 * 24 * 60 * 60;
      const finalLabel = token_label || `agent-${agent_name}`;

      const token = await new SignJWT({
        project_id: projectId,
        user_id: authContext.user_id,
        role: 'admin',
        label: finalLabel,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev')
        .setSubject(projectId)
        .setAudience('mcp-server')
        .setIssuedAt(now)
        .setExpirationTime(now + expiresIn)
        .setJti(jti)
        .sign(secret);

      const keyHash = crypto.createHash('sha256').update(token).digest('hex');
      await supabase.from('project_api_keys').insert({
        id: jti,
        project_id: projectId,
        key_hash: keyHash,
        key_prefix: token.substring(0, 12) + '...',
        label: finalLabel,
        expires_at: new Date((now + expiresIn) * 1000).toISOString(),
      });

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'agent_provision',
        query: agent_name,
        toolName: 'quoth_project_provision_agent',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Agent fully provisioned!

**Agent:** ${agent_name} (${display_name || agent_name})
**Agent ID:** ${agentId}
**Project:** ${project_slug} (\`${projectId}\`)
**Instance:** ${instance}
**Token Label:** ${finalLabel}

**MCP Token (save — shown once):**
\`\`\`
${token}
\`\`\`

**mcporter config:**
\`\`\`json
{
  "mcpServers": {
    "quoth": {
      "type": "http",
      "url": "https://quoth.triqual.dev/api/mcp",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}
\`\`\``,
          },
        ],
      };
    }
  );
}
