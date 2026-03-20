/**
 * Quoth v3.0 Project Management MCP Tools
 * Create projects, generate tokens, list projects
 * Enables full agent autonomy — no dashboard needed
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
 * Register project management tools on the MCP server
 */
export function registerProjectTools(
  server: McpServer,
  authContext: AuthContext
) {
  // ─── Tool 1: quoth_project_create ───────────────────────────
  server.registerTool(
    'quoth_project_create',
    {
      title: 'Create Project',
      description:
        'Create a new project in your organization. Returns the project ID. ' +
        'Use this to provision new agent workspaces programmatically.',
      inputSchema: {
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .describe('Project slug (lowercase, hyphens). e.g. "deployer-verticals"'),
        github_repo: z
          .string()
          .optional()
          .describe('Optional GitHub repo URL'),
        is_public: z
          .boolean()
          .default(false)
          .describe('Whether project docs are publicly searchable'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);
      const { slug, github_repo, is_public } = args;

      // Check if project already exists
      const { data: existing } = await supabase
        .from('projects')
        .select('id, slug')
        .eq('organization_id', organizationId)
        .eq('slug', slug)
        .single();

      if (existing) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Project "${slug}" already exists.\n\n**ID:** ${existing.id}\n**Slug:** ${existing.slug}`,
            },
          ],
        };
      }

      const { data: project, error } = await supabase
        .from('projects')
        .insert({
          slug,
          github_repo: github_repo || '',
          is_public: is_public || false,
          organization_id: organizationId,
          owner_id: authContext.user_id,
          created_by: authContext.user_id,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create project: ${error.message}`);
      }

      // Auto-add creator as admin member
      await supabase.from('project_members').insert({
        project_id: project.id,
        user_id: authContext.user_id,
        role: 'admin',
      });

      await logActivity({
        projectId: authContext.project_id,
        userId: authContext.user_id,
        eventType: 'project_create',
        query: slug,
        toolName: 'quoth_project_create',
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✅ Project created!

**ID:** ${project.id}
**Slug:** ${slug}
**Public:** ${is_public || false}
**Organization:** ${organizationId}

Use \`quoth_token_generate\` to create an MCP token for this project.`,
          },
        ],
      };
    }
  );

  // ─── Tool 2: quoth_token_generate ───────────────────────────
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
          .describe('Project UUID. If omitted, uses the project from slug lookup.'),
        project_slug: z
          .string()
          .optional()
          .describe('Project slug (alternative to project_id)'),
        label: z
          .string()
          .describe('Token label, e.g. "agent-deployer" or "ci-pipeline"'),
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

      // Resolve project
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

      // Verify caller has admin access
      if (authContext.role !== 'admin') {
        throw new Error('Only admins can generate tokens');
      }

      // Generate JWT
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

      // Store hashed token
      const keyHash = crypto.createHash('sha256').update(token).digest('hex');
      const keyPrefix = token.substring(0, 12) + '...';

      const { error: insertError } = await supabase
        .from('project_api_keys')
        .insert({
          id: jti,
          project_id: targetProjectId,
          key_hash: keyHash,
          key_prefix: keyPrefix,
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
**JTI:** ${jti}

**Token (save this — shown only once):**
\`\`\`
${token}
\`\`\`

Configure in mcporter:
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

  // ─── Tool 3: quoth_project_list ─────────────────────────────
  server.registerTool(
    'quoth_project_list',
    {
      title: 'List Projects',
      description:
        'List all projects in your organization.',
      inputSchema: {
        include_public: z
          .boolean()
          .default(false)
          .describe('Include public projects from other orgs'),
      },
    },
    async (args) => {
      const organizationId = await getOrganizationId(authContext.project_id);

      let query = supabase
        .from('projects')
        .select('id, slug, is_public, github_repo, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      const { data: projects, error } = await query;

      if (error) {
        throw new Error(`Failed to list projects: ${error.message}`);
      }

      if (!projects || projects.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No projects found.' },
          ],
        };
      }

      const formatted = projects
        .map(
          (p) =>
            `- **${p.slug}** (\`${p.id}\`)
  - Public: ${p.is_public}
  - Repo: ${p.github_repo || 'none'}
  - Created: ${p.created_at}`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `# Projects (${projects.length})

${formatted}`,
          },
        ],
      };
    }
  );

  // ─── Tool 4: quoth_project_provision_agent ──────────────────
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
          .describe('Human-readable name. e.g. "Deployer 🚀"'),
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

        // Add membership
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

      // Store token hash
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
