/**
 * Agent-Project Graph View
 * Visual node-based UI for managing agent-project assignments
 */

import { auth } from '@clerk/nextjs/server';
import { getDb, getSecureDb } from '@/db/connection';
import { sql } from 'drizzle-orm';
import { cacheTag, cacheLife } from 'next/cache';
import { redirect } from 'next/navigation';
import { AgentProjectGraph } from '@/components/agents/AgentProjectGraph';

async function getAgentGraphData(userId: string) {
  'use cache'
  cacheTag('agents-graph')
  cacheLife('minutes')

  // Get user's organization (self-lookup, no RLS needed)
  const pooledDb = getDb();
  const userRow = await pooledDb.execute(sql`
    SELECT id, default_org_id FROM public.users WHERE clerk_user_id = ${userId}
  `).then(r => r.rows[0] as any);

  if (!userRow?.default_org_id) {
    return { organizationId: null, agents: [] as any[], projects: [] as any[], assignments: [] as any[] };
  }

  const organizationId = userRow.default_org_id;
  const db = await getSecureDb(organizationId, userRow.id);

  // Fetch agents
  const agents = await db.execute(sql`
    SELECT id, agent_name, display_name, instance, status
    FROM agents.registry
    WHERE org_id = ${organizationId}
    ORDER BY agent_name
  `).then(r => r.rows as any[]);

  // Fetch projects
  const projects = await db.execute(sql`
    SELECT id, slug, is_public
    FROM public.projects
    WHERE org_id = ${organizationId}
    ORDER BY slug
  `).then(r => r.rows as any[]);

  // Fetch agent-project assignments
  const agentIds = agents.map((a: any) => a.id);
  const projectIds = projects.map((p: any) => p.id);
  const assignments = (agentIds.length > 0 && projectIds.length > 0)
    ? await db.execute(sql`
        SELECT agent_id, project_id, role
        FROM agents.agent_projects
        WHERE agent_id = ANY(${agentIds}) AND project_id = ANY(${projectIds})
      `).then(r => r.rows as any[])
    : [];

  return { organizationId, agents, projects, assignments };
}

export default async function AgentGraphPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/');
  }

  const { organizationId, agents, projects, assignments } = await getAgentGraphData(userId);

  if (!organizationId) {
    return (
      <div className="px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-400">No organization found for this user.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <AgentProjectGraph
        agents={agents || []}
        projects={projects || []}
        assignments={assignments || []}
        organizationId={organizationId}
      />
    </div>
  );
}
