/**
 * Agent Detail Page
 * Shows agent info, assigned projects, messaging, and metadata
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Bot, ArrowLeft, Circle, Server, Cpu, FolderOpen, Calendar } from 'lucide-react';

interface AgentWithProjects {
  id: string;
  agent_name: string;
  display_name: string | null;
  instance: string;
  model: string | null;
  role: string | null;
  status: 'active' | 'inactive' | 'archived';
  last_seen_at: string | null;
  created_at: string;
  capabilities: Record<string, any> | null;
  metadata: Record<string, any> | null;
  agent_projects: Array<{
    project_id: string;
    role: string;
    assigned_at: string;
    assigned_by: string | null;
    projects: {
      id: string;
      slug: string;
      is_public: boolean;
    };
  }>;
}

export default async function AgentDetailPage({ params }: { params: { name: string } }) {
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
    notFound();
  }

  // Fetch agent with projects
  const { data: agent, error } = await supabase
    .from('agents')
    .select(`
      *,
      agent_projects(
        project_id,
        role,
        assigned_at,
        assigned_by,
        projects(
          id,
          slug,
          is_public
        )
      )
    `)
    .eq('organization_id', profile.organization_id)
    .eq('agent_name', params.name)
    .single();

  if (error || !agent) {
    notFound();
  }

  const agentData = agent as AgentWithProjects;
  const isOnline = agentData.last_seen_at && 
    new Date(agentData.last_seen_at).getTime() > Date.now() - 5 * 60 * 1000;

  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-5xl mx-auto">
        {/* Back Link */}
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Agents</span>
        </Link>

        {/* Agent Header */}
        <div className="glass-panel rounded-2xl p-8 mb-8 animate-page-enter">
          <div className="flex items-start gap-6">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border border-violet-spectral/20">
              <Bot className="w-10 h-10 text-violet-spectral" />
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold font-cinzel text-white">
                  {agentData.display_name || agentData.agent_name}
                </h1>
                
                {/* Status Badge */}
                {agentData.status === 'active' && isOnline ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-medium">
                    <Circle className="w-2.5 h-2.5 fill-green-400" />
                    Online
                  </span>
                ) : agentData.status === 'active' ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-spectral/10 border border-violet-spectral/30 text-violet-ghost text-sm font-medium">
                    <Circle className="w-2.5 h-2.5 fill-violet-spectral" />
                    Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-500/10 border border-gray-500/30 text-gray-400 text-sm font-medium">
                    <Circle className="w-2.5 h-2.5 fill-gray-400" />
                    {agentData.status}
                  </span>
                )}
              </div>
              
              <p className="text-gray-500 mb-4">@{agentData.agent_name}</p>
              
              {/* Agent Metadata */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Instance</p>
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-violet-spectral" />
                    <span className="text-sm text-white">{agentData.instance}</span>
                  </div>
                </div>
                
                {agentData.model && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Model</p>
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-violet-spectral" />
                      <span className="text-sm text-white">{agentData.model}</span>
                    </div>
                  </div>
                )}
                
                {agentData.role && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Role</p>
                    <span className="text-sm text-white capitalize">{agentData.role}</span>
                  </div>
                )}
                
                {agentData.last_seen_at && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Last Seen</p>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-violet-spectral" />
                      <span className="text-sm text-white">
                        {new Date(agentData.last_seen_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Assigned Projects */}
        <div className="glass-panel rounded-2xl p-8 animate-stagger stagger-1">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <FolderOpen className="w-5 h-5 text-violet-spectral" />
              <h2 className="text-xl font-semibold text-white">Assigned Projects</h2>
              <span className="px-2.5 py-1 rounded-full bg-violet-spectral/10 text-violet-ghost text-sm font-medium">
                {agentData.agent_projects.length}
              </span>
            </div>
            
            {/* TODO: Add "Assign Project" button here */}
          </div>

          {agentData.agent_projects.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-4">
                This agent is not assigned to any projects yet.
              </p>
              <p className="text-sm text-gray-500">
                Use <code className="px-2 py-1 bg-charcoal rounded text-violet-ghost">quoth_agent_assign_project</code> to assign projects.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {agentData.agent_projects.map(({ project_id, role, assigned_at, assigned_by, projects }) => (
                <Link
                  key={project_id}
                  href={`/dashboard/${projects.slug}`}
                  className="block p-4 rounded-xl border border-charcoal hover:border-violet-spectral/30 bg-charcoal/30 hover:bg-violet-spectral/5 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="w-5 h-5 text-gray-500 group-hover:text-violet-spectral transition-colors" />
                      <div>
                        <p className="font-medium text-white group-hover:text-violet-ghost transition-colors">
                          {projects.slug}
                        </p>
                        <p className="text-xs text-gray-500">
                          Assigned {new Date(assigned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {assigned_by && ` by ${assigned_by}`}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {projects.is_public && (
                        <span className="px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium">
                          Public
                        </span>
                      )}
                      <span className="px-2.5 py-1 rounded-md bg-violet-spectral/10 border border-violet-spectral/30 text-violet-ghost text-xs font-medium capitalize">
                        {role}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Capabilities & Metadata */}
        {(agentData.capabilities || agentData.metadata) && (
          <div className="glass-panel rounded-2xl p-8 mt-8 animate-stagger stagger-2">
            <h2 className="text-xl font-semibold text-white mb-6">Technical Details</h2>
            
            <div className="grid gap-6">
              {agentData.capabilities && Object.keys(agentData.capabilities).length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-3">Capabilities</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(agentData.capabilities).map(([key, value]) => (
                      <div
                        key={key}
                        className="px-3 py-2 rounded-lg bg-charcoal border border-violet-spectral/20 text-sm"
                      >
                        <span className="text-gray-400">{key}:</span>{' '}
                        <span className="text-white font-mono">
                          {typeof value === 'boolean' ? (value ? '✓' : '✗') : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {agentData.metadata && Object.keys(agentData.metadata).length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-3">Metadata</h3>
                  <pre className="p-4 rounded-lg bg-charcoal border border-graphite text-sm text-gray-300 overflow-x-auto">
                    {JSON.stringify(agentData.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TODO: Add Messaging section */}
      </div>
    </div>
  );
}
