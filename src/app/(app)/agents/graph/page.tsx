/**
 * Agent-Project Graph View
 * Visual node-based UI for managing agent-project assignments
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AgentProjectGraph } from '@/components/agents/AgentProjectGraph';

export default async function AgentGraphPage() {
  const supabase = await createServerSupabaseClient();
  
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  // Get user's organization
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) {
    return (
      <div className="px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-400">No organization found for this user.</p>
        </div>
      </div>
    );
  }

  // Fetch agents
  const { data: agents } = await supabase
    .from('agents')
    .select('id, agent_name, display_name, instance, status')
    .eq('organization_id', profile.organization_id)
    .order('agent_name');

  // Fetch projects
  const { data: projects } = await supabase
    .from('projects')
    .select('id, slug, is_public')
    .eq('organization_id', profile.organization_id)
    .order('slug');

  // Fetch agent-project assignments
  const { data: assignments } = await supabase
    .from('agent_projects')
    .select('agent_id, project_id, role')
    .in('agent_id', (agents || []).map((a: { id: string }) => a.id))
    .in('project_id', (projects || []).map((p: { id: string }) => p.id));

  return (
    <div className="h-screen flex flex-col">
      <AgentProjectGraph
        agents={agents || []}
        projects={projects || []}
        assignments={assignments || []}
        organizationId={profile.organization_id}
      />
    </div>
  );
}
