/**
 * Main Dashboard Page
 * Shows user's projects, proposal stats, and quick actions
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Navbar } from '@/components/quoth/Navbar';

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  // Fetch user's projects
  const { data: projects } = await supabase
    .from('projects')
    .select('*, project_members!inner(role)')
    .eq('project_members.user_id', user.id);

  // Fetch proposal count
  const projectIds = projects?.map((p) => p.id) || [];
  const { count: proposalCount } = await supabase
    .from('document_proposals')
    .select('*', { count: 'exact', head: true })
    .in('project_id', projectIds);

  // Fetch document count
  const { count: documentCount } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .in('project_id', projectIds);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gradient-to-b from-obsidian to-charcoal pt-24 px-6 pb-12">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold font-cinzel mb-2">Dashboard</h1>
            <p className="text-gray-400">Manage your Quoth projects and documentation</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="glass-panel p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-400">Projects</h3>
                <svg
                  className="w-5 h-5 text-violet-spectral"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </div>
              <p className="text-3xl font-bold">{projects?.length || 0}</p>
            </div>

            <div className="glass-panel p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-400">Documents</h3>
                <svg
                  className="w-5 h-5 text-violet-spectral"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <p className="text-3xl font-bold">{documentCount || 0}</p>
            </div>

            <div className="glass-panel p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-400">Proposals</h3>
                <svg
                  className="w-5 h-5 text-violet-spectral"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <p className="text-3xl font-bold">{proposalCount || 0}</p>
            </div>

            <Link
              href="/dashboard/api-keys"
              className="glass-panel p-6 hover:border-violet-spectral transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-400">API Keys</h3>
                <svg
                  className="w-5 h-5 text-violet-spectral group-hover:translate-x-1 transition-transform"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
              <p className="text-3xl font-bold">Manage</p>
            </Link>
          </div>

          {/* Projects List */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold font-cinzel mb-4">Your Projects</h2>
            <div className="space-y-4">
              {projects && projects.length > 0 ? (
                projects.map((project) => (
                  <div key={project.id} className="glass-panel p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-xl font-bold mb-1">{project.slug}</h3>
                        {project.github_repo && (
                          <p className="text-sm text-gray-400 mb-2">
                            <span className="text-violet-ghost">GitHub:</span> {project.github_repo}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-gray-400">
                            Role:{' '}
                            <span className="text-violet-spectral font-medium">
                              {project.project_members[0]?.role}
                            </span>
                          </span>
                          {project.is_public && (
                            <span className="px-2 py-1 bg-violet-spectral/10 text-violet-spectral text-xs rounded-full border border-violet-spectral/20">
                              Public
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Link
                          href={`/dashboard/${project.slug}/team`}
                          className="text-violet-spectral hover:text-violet-glow transition-colors text-sm"
                        >
                          Manage Team →
                        </Link>
                        <Link
                          href="/proposals"
                          className="text-violet-spectral hover:text-violet-glow transition-colors text-sm"
                        >
                          View Proposals →
                        </Link>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="glass-panel p-8 text-center">
                  <p className="text-gray-400 mb-4">No projects found</p>
                  <p className="text-sm text-gray-500">
                    Your default project will be created automatically after email verification
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Link
              href="/proposals"
              className="glass-panel p-6 hover:border-violet-spectral transition-colors group"
            >
              <h3 className="text-lg font-bold mb-2 group-hover:text-violet-ghost transition-colors">
                Review Proposals
              </h3>
              <p className="text-sm text-gray-400">
                View and manage documentation update proposals
              </p>
            </Link>

            <Link
              href="/dashboard/api-keys"
              className="glass-panel p-6 hover:border-violet-spectral transition-colors group"
            >
              <h3 className="text-lg font-bold mb-2 group-hover:text-violet-ghost transition-colors">
                MCP Integration
              </h3>
              <p className="text-sm text-gray-400">
                Generate API keys for Claude Desktop
              </p>
            </Link>

            <Link
              href="/protocol"
              className="glass-panel p-6 hover:border-violet-spectral transition-colors group"
            >
              <h3 className="text-lg font-bold mb-2 group-hover:text-violet-ghost transition-colors">
                Documentation
              </h3>
              <p className="text-sm text-gray-400">
                Learn how to use Quoth MCP tools
              </p>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
