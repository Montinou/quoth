/**
 * Agent-Project Graph View
 * Visual node-based UI for managing agent-project assignments
 */

import { auth } from '@clerk/nextjs/server';
import { getDb, getSecureDb } from '@/db/connection';
import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { AgentProjectGraph } from '@/components/agents/AgentProjectGraph';
export const revalidate = 60;

interface UserRow {
  id: string;
  default_org_id: string | null;
}

interface GraphAgentRow {
  id: string;
  agent_name: string;
  display_name: string | null;
  instance: string;
  status: string;
}

interface GraphProjectRow {
  id: string;
  slug: string;
  is_public: boolean;
}

interface GraphAssignmentRow {
  agent_id: string;
  project_id: string;
  role: 'contributor' | 'owner' | 'readonly';
}

export default async function AgentGraphPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/');
  }

  // Get user's organization (self-lookup, no RLS needed)
  const pooledDb = getDb();
  const userRow = await pooledDb.execute(sql`
    SELECT id, default_org_id FROM public.users WHERE clerk_user_id = ${userId}
  `).then(r => r.rows[0] as unknown as UserRow | undefined);

  if (!userRow?.default_org_id) {
    return (
      <div className="px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-400">No organization found for this user.</p>
        </div>
      </div>
    );
  }

  const organizationId = userRow.default_org_id;
  const db = await getSecureDb(organizationId, userRow.id);

  // Fetch agents
  const agents = await db.execute(sql`
    SELECT id, agent_name, display_name, instance, status
    FROM agents.registry
    WHERE org_id = ${organizationId}
    ORDER BY agent_name
  `).then(r => r.rows as unknown as GraphAgentRow[]);

  // Fetch projects
  const projects = await db.execute(sql`
    SELECT id, slug, is_public
    FROM public.projects
    WHERE org_id = ${organizationId}
    ORDER BY slug
  `).then(r => r.rows as unknown as GraphProjectRow[]);

  // Fetch agent-project assignments
  const agentIds = agents.map((a) => a.id);
  const projectIds = projects.map((p) => p.id);
  const pgAgentIds = `{${agentIds.join(',')}}`;
  const pgProjectIds = `{${projectIds.join(',')}}`;
  const assignments: GraphAssignmentRow[] = (agentIds.length > 0 && projectIds.length > 0)
    ? await db.execute(sql`
        SELECT agent_id, project_id, role
        FROM agents.agent_projects
        WHERE agent_id = ANY(${pgAgentIds}::uuid[]) AND project_id = ANY(${pgProjectIds}::uuid[])
      `).then(r => r.rows as unknown as GraphAssignmentRow[])
    : [];

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
