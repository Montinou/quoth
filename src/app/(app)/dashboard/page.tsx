/**
 * Main Dashboard Page
 * Elegant overview with animated stats, projects, and quick actions
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getLatestCoverage } from '@/lib/quoth/coverage';
import { CoverageCard } from '@/components/dashboard/CoverageCard';
import { ActivityCard } from '@/components/dashboard/ActivityCard';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  FolderOpen,
  FileText,
  GitPullRequest,
  Key,
  ArrowRight,
  BookOpen,
  Sparkles,
  Users,
  Shield,
  Globe,
} from 'lucide-react';

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

  // Fetch coverage for first project
  let initialCoverage = null;
  const firstProject = projects?.[0];
  if (firstProject) {
    initialCoverage = await getLatestCoverage(firstProject.id);
  }

  // Stats data
  const stats = [
    {
      label: 'Projects',
      value: projects?.length || 0,
      icon: FolderOpen,
      color: 'violet',
      href: null,
    },
    {
      label: 'Documents',
      value: documentCount || 0,
      icon: FileText,
      color: 'blue',
      href: '/knowledge-base',
    },
    {
      label: 'Proposals',
      value: proposalCount || 0,
      icon: GitPullRequest,
      color: 'amber',
      href: '/proposals',
    },
    {
      label: 'API Keys',
      value: 'Manage',
      icon: Key,
      color: 'emerald',
      href: '/dashboard/api-keys',
      isAction: true,
    },
  ];

  const quickActions = [
    {
      title: 'Review Proposals',
      description: 'View and approve documentation updates from AI agents',
      icon: GitPullRequest,
      href: '/proposals',
      color: 'from-violet-spectral/20 to-violet-glow/10',
    },
    {
      title: 'MCP Integration',
      description: 'Generate API keys for Claude Desktop and other MCP clients',
      icon: Key,
      href: '/dashboard/api-keys',
      color: 'from-emerald-muted/20 to-emerald-muted/10',
    },
    {
      title: 'Documentation',
      description: 'Learn how to use Quoth MCP tools and best practices',
      icon: BookOpen,
      href: '/protocol',
      color: 'from-blue-500/20 to-blue-500/10',
    },
  ];

  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-stagger stagger-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border border-violet-spectral/20">
              <Sparkles className="w-5 h-5 text-violet-spectral" />
            </div>
            <span className="text-sm font-medium text-violet-ghost/70 uppercase tracking-wider">
              Welcome back
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-cinzel mb-3 text-white">
            Dashboard
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Manage your Quoth projects, review AI-proposed documentation updates, and configure MCP integrations.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-10">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            const content = (
              <div
                className={`
                  glass-panel stat-card rounded-2xl p-6
                  ${stat.href ? 'cursor-pointer group' : ''}
                  animate-stagger stagger-${index + 2}
                `}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-gray-400">{stat.label}</h3>
                  <div
                    className={`
                      p-2 rounded-lg transition-all duration-300
                      ${stat.color === 'violet' ? 'bg-violet-spectral/15 text-violet-spectral group-hover:bg-violet-spectral/25' : ''}
                      ${stat.color === 'blue' ? 'bg-blue-500/15 text-blue-400 group-hover:bg-blue-500/25' : ''}
                      ${stat.color === 'amber' ? 'bg-amber-warning/15 text-amber-warning group-hover:bg-amber-warning/25' : ''}
                      ${stat.color === 'emerald' ? 'bg-emerald-muted/15 text-emerald-muted group-hover:bg-emerald-muted/25' : ''}
                    `}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
                <div className="flex items-end justify-between">
                  <p
                    className={`
                      text-3xl md:text-4xl font-bold stat-number
                      ${stat.isAction ? 'text-lg md:text-xl text-violet-ghost' : 'text-white'}
                    `}
                    style={{ animationDelay: `${0.3 + index * 0.1}s` }}
                  >
                    {stat.value}
                  </p>
                  {stat.href && (
                    <ArrowRight className="w-4 h-4 text-gray-500 action-arrow group-hover:text-violet-spectral transition-colors" />
                  )}
                </div>
              </div>
            );

            return stat.href ? (
              <Link key={stat.label} href={stat.href}>
                {content}
              </Link>
            ) : (
              <div key={stat.label}>{content}</div>
            );
          })}
        </div>

        {/* Coverage Card */}
        {firstProject && (
          <div className="mb-10 animate-stagger stagger-5">
            <CoverageCard projectId={firstProject.id} initialCoverage={initialCoverage} />
          </div>
        )}

        {/* Activity Section */}
        {firstProject && (
          <div className="mb-10 animate-stagger stagger-6">
            <ActivityCard projectId={firstProject.id} />
          </div>
        )}

        {/* Projects Section */}
        <div className="mb-10 animate-stagger stagger-7">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold font-cinzel text-white flex items-center gap-3">
              <FolderOpen className="w-6 h-6 text-violet-spectral" />
              Your Projects
            </h2>
          </div>

          <div className="space-y-4">
            {projects && projects.length > 0 ? (
              projects.map((project, index) => (
                <div
                  key={project.id}
                  className="glass-panel interactive-card rounded-2xl p-6 animate-stagger"
                  style={{ animationDelay: `${0.4 + index * 0.1}s` }}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-xl font-bold text-white">{project.slug}</h3>
                        <div className="flex items-center gap-2">
                          <span
                            className={`
                              px-2.5 py-1 text-xs font-medium rounded-full border
                              ${project.project_members[0]?.role === 'admin'
                                ? 'bg-violet-spectral/15 text-violet-ghost border-violet-spectral/30'
                                : project.project_members[0]?.role === 'editor'
                                ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                                : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                              }
                            `}
                          >
                            <Shield className="w-3 h-3 inline-block mr-1" />
                            {project.project_members[0]?.role}
                          </span>
                          {project.is_public && (
                            <span className="px-2.5 py-1 bg-emerald-muted/15 text-emerald-muted text-xs font-medium rounded-full border border-emerald-muted/30">
                              <Globe className="w-3 h-3 inline-block mr-1" />
                              Public
                            </span>
                          )}
                        </div>
                      </div>
                      {project.github_repo && (
                        <p className="text-sm text-gray-500">
                          <span className="text-violet-ghost/70">GitHub:</span> {project.github_repo}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/dashboard/${project.slug}/team`}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-charcoal/80 text-gray-300 hover:text-white hover:bg-violet-spectral/20 border border-transparent hover:border-violet-spectral/30 transition-all duration-300"
                      >
                        <Users className="w-4 h-4" />
                        Team
                      </Link>
                      <Link
                        href="/proposals"
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-violet-spectral/20 text-violet-ghost hover:bg-violet-spectral/30 border border-violet-spectral/30 transition-all duration-300"
                      >
                        <GitPullRequest className="w-4 h-4" />
                        Proposals
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="glass-panel rounded-2xl p-12 text-center">
                <div className="inline-flex p-4 rounded-2xl bg-violet-spectral/10 mb-4 empty-state-icon">
                  <FolderOpen className="w-8 h-8 text-violet-spectral" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">No projects yet</h3>
                <p className="text-gray-400 mb-4 max-w-md mx-auto">
                  Your default project will be created automatically after email verification.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="animate-stagger stagger-8">
          <h2 className="text-2xl font-bold font-cinzel text-white mb-6 flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-violet-spectral" />
            Quick Actions
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {quickActions.map((action, index) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.title}
                  href={action.href}
                  className={`
                    glass-panel interactive-card rounded-2xl p-6 group
                    animate-stagger
                  `}
                  style={{ animationDelay: `${0.5 + index * 0.1}s` }}
                >
                  <div
                    className={`
                      inline-flex p-3 rounded-xl mb-4 bg-gradient-to-br ${action.color}
                      transition-all duration-300 group-hover:scale-110
                    `}
                  >
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2 group-hover:text-violet-ghost transition-colors">
                    {action.title}
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">
                    {action.description}
                  </p>
                  <div className="flex items-center text-sm text-violet-spectral font-medium">
                    <span>Get started</span>
                    <ArrowRight className="w-4 h-4 ml-2 action-arrow" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
