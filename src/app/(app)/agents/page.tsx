/**
 * Agent Directory - List all agents in organization
 * Shows status, last_seen, instance, and assigned projects
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Bot, Circle, Clock, Server, FolderOpen, Network } from 'lucide-react';
import { AgentProjectGraphMini } from '@/components/agents/AgentProjectGraphMini';

interface Agent {
  id: string;
  agent_name: string;
  display_name: string | null;
  instance: string;
  model: string | null;
  role: string | null;
  status: 'active' | 'inactive' | 'archived';
  last_seen_at: string | null;
  created_at: string;
  project_count?: number;
}

export default async function AgentsPage() {
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
        <div className="max-w-5xl mx-auto">
          <p className="text-gray-400">No organization found for this user.</p>
        </div>
      </div>
    );
  }

  // Fetch all agents in organization
  const { data: agents, error } = await supabase
    .from('agents')
    .select(`
      *,
      agent_projects(count)
    `)
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch agents:', error);
  }

  const agentList = (agents || []).map(agent => ({
    ...agent,
    project_count: agent.agent_projects?.[0]?.count || 0,
  })) as Agent[];

  // Fetch projects and assignments for graph
  const { data: projects } = await supabase
    .from('projects')
    .select('id, slug')
    .eq('organization_id', profile.organization_id)
    .order('slug');

  const { data: assignments } = await supabase
    .from('agent_projects')
    .select('agent_id, project_id, role')
    .in('agent_id', agentList.map(a => a.id));

  // Status badge component
  const StatusBadge = ({ status, lastSeen }: { status: string; lastSeen: string | null }) => {
    const isOnline = lastSeen && new Date(lastSeen).getTime() > Date.now() - 5 * 60 * 1000; // 5 min
    
    if (status === 'active' && isOnline) {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium">
          <Circle className="w-2 h-2 fill-green-400" />
          Online
        </span>
      );
    }
    
    if (status === 'active') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-spectral/10 border border-violet-spectral/30 text-violet-ghost text-xs font-medium">
          <Circle className="w-2 h-2 fill-violet-spectral" />
          Active
        </span>
      );
    }
    
    if (status === 'inactive') {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-500/10 border border-gray-500/30 text-gray-400 text-xs font-medium">
          <Circle className="w-2 h-2 fill-gray-400" />
          Inactive
        </span>
      );
    }
    
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium">
        <Circle className="w-2 h-2 fill-red-400" />
        Archived
      </span>
    );
  };

  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-stagger stagger-1">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border border-violet-spectral/20">
                <Bot className="w-5 h-5 text-violet-spectral" />
              </div>
              <span className="text-sm font-medium text-violet-ghost/70 uppercase tracking-wider">
                Multi-Agent System
              </span>
            </div>
            <Link
              href="/agents/graph"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-spectral to-violet-glow hover:from-violet-glow hover:to-violet-spectral text-white font-semibold transition-all duration-300 shadow-lg shadow-violet-spectral/20 hover:shadow-xl hover:shadow-violet-spectral/30"
            >
              <Network className="w-4 h-4" />
              <span>Graph View</span>
            </Link>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-3">
            Agent Directory
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Manage agents in your organization. View status, assign projects, and coordinate work.
          </p>
        </div>

        {/* Organization Map Widget */}
        {agentList.length > 0 && (projects?.length || 0) > 0 && (
          <div className="glass-panel rounded-2xl p-6 mb-8 animate-stagger stagger-2">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Network className="w-5 h-5 text-violet-spectral" />
                <h2 className="text-xl font-semibold text-white">Organization Map</h2>
                <span className="text-sm text-gray-500">
                  {agentList.length} agents • {projects?.length || 0} projects • {assignments?.length || 0} connections
                </span>
              </div>
              <Link
                href="/agents/graph"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-spectral to-violet-glow hover:from-violet-glow hover:to-violet-spectral text-white transition-all text-sm font-medium"
              >
                <span>Full View</span>
                <Network className="w-4 h-4" />
              </Link>
            </div>
            
            {/* Embedded mini graph */}
            <div className="relative h-[400px] rounded-xl bg-obsidian border border-charcoal overflow-hidden">
              <AgentProjectGraphMini
                agents={agentList.map(a => ({ id: a.id, agent_name: a.agent_name, display_name: a.display_name }))}
                projects={projects || []}
                assignments={assignments || []}
              />
            </div>
          </div>
        )}

        {/* Agent Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 animate-stagger stagger-3">
          <div className="glass-panel rounded-xl p-5">
            <p className="text-gray-500 text-sm mb-1">Total Agents</p>
            <p className="text-3xl font-bold text-white">{agentList.length}</p>
          </div>
          <div className="glass-panel rounded-xl p-5">
            <p className="text-gray-500 text-sm mb-1">Active</p>
            <p className="text-3xl font-bold text-green-400">
              {agentList.filter(a => a.status === 'active').length}
            </p>
          </div>
          <div className="glass-panel rounded-xl p-5">
            <p className="text-gray-500 text-sm mb-1">Projects Assigned</p>
            <p className="text-3xl font-bold text-violet-spectral">
              {agentList.reduce((sum, a) => sum + (a.project_count || 0), 0)}
            </p>
          </div>
        </div>

        {/* Agent List */}
        {agentList.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center animate-stagger stagger-4">
            <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 mb-6">
              <Bot className="text-violet-spectral w-10 h-10" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-3">
              No agents yet
            </h3>
            <p className="text-gray-400 max-w-lg mx-auto text-lg mb-6">
              Register your first agent using the <code className="px-2 py-1 bg-charcoal rounded text-violet-ghost">quoth_agent_register</code> MCP tool.
            </p>
            <Link
              href="/guide"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-spectral to-violet-glow hover:from-violet-glow hover:to-violet-spectral text-white rounded-xl font-semibold transition-all duration-300 shadow-lg shadow-violet-spectral/20 hover:shadow-xl hover:shadow-violet-spectral/30"
            >
              View Documentation
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 animate-stagger stagger-4">
            {agentList.map((agent, index) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.agent_name}`}
                className="glass-panel interactive-card rounded-2xl p-6 group"
                style={{ animationDelay: `${0.3 + index * 0.05}s` }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="p-3 rounded-xl bg-violet-spectral/15 text-violet-spectral group-hover:bg-violet-spectral/25 transition-colors">
                      <Bot className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-white text-lg group-hover:text-violet-ghost transition-colors">
                          {agent.display_name || agent.agent_name}
                        </h3>
                        <StatusBadge status={agent.status} lastSeen={agent.last_seen_at} />
                      </div>
                      <p className="text-sm text-gray-500 mb-3">@{agent.agent_name}</p>
                      
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                        <div className="flex items-center gap-1.5">
                          <Server className="w-4 h-4" />
                          <span>{agent.instance}</span>
                        </div>
                        {agent.role && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-1 h-1 bg-gray-600 rounded-full" />
                            <span>{agent.role}</span>
                          </div>
                        )}
                        {(agent.project_count ?? 0) > 0 && (
                          <div className="flex items-center gap-1.5">
                            <FolderOpen className="w-4 h-4" />
                            <span>{agent.project_count ?? 0} project{(agent.project_count ?? 0) !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                        {agent.last_seen_at && (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" />
                            <span>
                              {new Date(agent.last_seen_at).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
