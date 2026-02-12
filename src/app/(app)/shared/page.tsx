/**
 * Shared Knowledge Browser
 * Cross-project documentation shared across the organization
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Globe, FileText, Clock, FolderOpen, Search } from 'lucide-react';

interface SharedDocument {
  id: string;
  title: string;
  file_path: string;
  project_id: string;
  version: number;
  last_updated: string;
  projects: {
    slug: string;
  };
}

export default async function SharedKnowledgePage() {
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

  // Fetch all shared documents in organization
  const { data: sharedDocs, error } = await supabase
    .from('documents')
    .select(`
      id,
      title,
      file_path,
      project_id,
      version,
      last_updated,
      projects!inner(
        slug,
        organization_id
      )
    `)
    .eq('visibility', 'shared')
    .eq('projects.organization_id', profile.organization_id)
    .order('last_updated', { ascending: false });

  if (error) {
    console.error('Failed to fetch shared documents:', error);
  }

  const documents = (sharedDocs || []) as any as SharedDocument[];

  // Group documents by project
  const projectGroups = documents.reduce((acc, doc) => {
    const projectSlug = doc.projects.slug;
    if (!acc[projectSlug]) {
      acc[projectSlug] = [];
    }
    acc[projectSlug].push(doc);
    return acc;
  }, {} as Record<string, SharedDocument[]>);

  return (
    <div className="px-6 py-8 md:py-10">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10 animate-stagger stagger-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 border border-violet-spectral/20">
              <Globe className="w-5 h-5 text-violet-spectral" />
            </div>
            <span className="text-sm font-medium text-violet-ghost/70 uppercase tracking-wider">
              Organization-Wide
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-3">
            Shared Knowledge
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Cross-project documentation accessible to all agents and users in your organization.
          </p>
        </div>

        {/* Search Bar - Coming Soon */}
        <div className="mb-8 animate-stagger stagger-2">
          <div className="relative rounded-2xl opacity-60 cursor-not-allowed">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input
              type="text"
              placeholder="Search shared knowledge... (Coming Soon)"
              className="w-full pl-14 pr-4 py-5 rounded-2xl border border-charcoal bg-charcoal/30 text-white placeholder:text-gray-500 outline-none text-lg"
              disabled
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 animate-stagger stagger-3">
          <div className="glass-panel rounded-xl p-5">
            <p className="text-gray-500 text-sm mb-1">Shared Documents</p>
            <p className="text-3xl font-bold text-white">{documents.length}</p>
          </div>
          <div className="glass-panel rounded-xl p-5">
            <p className="text-gray-500 text-sm mb-1">Projects Contributing</p>
            <p className="text-3xl font-bold text-violet-spectral">
              {Object.keys(projectGroups).length}
            </p>
          </div>
          <div className="glass-panel rounded-xl p-5">
            <p className="text-gray-500 text-sm mb-1">Organization</p>
            <p className="text-xl font-bold text-white mt-2">{profile.organization_id.slice(0, 8)}...</p>
          </div>
        </div>

        {/* Documents List */}
        {documents.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center animate-stagger stagger-4">
            <div className="inline-flex p-5 rounded-2xl bg-gradient-to-br from-violet-spectral/20 to-violet-glow/10 mb-6">
              <Globe className="text-violet-spectral w-10 h-10" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-3">
              No shared knowledge yet
            </h3>
            <p className="text-gray-400 max-w-lg mx-auto text-lg mb-6">
              Create documentation with <code className="px-2 py-1 bg-charcoal rounded text-violet-ghost">visibility: "shared"</code> to make it accessible across all projects in your organization.
            </p>
            <Link
              href="/guide"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-spectral to-violet-glow hover:from-violet-glow hover:to-violet-spectral text-white rounded-xl font-semibold transition-all duration-300 shadow-lg shadow-violet-spectral/20 hover:shadow-xl hover:shadow-violet-spectral/30"
            >
              View Documentation
            </Link>
          </div>
        ) : (
          <div className="space-y-8 animate-stagger stagger-4">
            {Object.entries(projectGroups).map(([projectSlug, docs], groupIndex) => (
              <div key={projectSlug} style={{ animationDelay: `${0.3 + groupIndex * 0.1}s` }}>
                {/* Project Header */}
                <div className="flex items-center gap-3 mb-4">
                  <FolderOpen className="w-5 h-5 text-violet-spectral" />
                  <Link
                    href={`/dashboard/${projectSlug}`}
                    className="text-lg font-semibold text-white hover:text-violet-ghost transition-colors"
                  >
                    {projectSlug}
                  </Link>
                  <span className="px-2.5 py-1 rounded-full bg-violet-spectral/10 text-violet-ghost text-sm font-medium">
                    {docs.length} doc{docs.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Documents Grid */}
                <div className="grid gap-3">
                  {docs.map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/knowledge-base/${doc.id}`}
                      className="glass-panel interactive-card rounded-xl p-5 group"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4 flex-1">
                          <div className="p-2.5 rounded-lg bg-violet-spectral/15 text-violet-spectral group-hover:bg-violet-spectral/25 transition-colors">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-white mb-1 group-hover:text-violet-ghost transition-colors">
                              {doc.title}
                            </h3>
                            <p className="text-sm text-gray-500 mb-2">{doc.file_path}</p>
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                <span>
                                  {new Date(doc.last_updated).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                              {doc.version > 1 && (
                                <span className="px-2 py-0.5 rounded-md bg-charcoal text-gray-400">
                                  v{doc.version}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium">
                          Shared
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
