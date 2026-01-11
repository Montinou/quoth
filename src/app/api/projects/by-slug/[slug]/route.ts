/**
 * Get Project by Slug API
 * GET /api/projects/by-slug/:slug - Get project details by slug
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get project by slug
    const { data: project, error } = await supabase
      .from('projects')
      .select('id, slug, is_public, github_repo')
      .eq('slug', slug)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 3. Verify user has access
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', project.id)
      .eq('user_id', user.id)
      .single();

    if (!membership && !project.is_public) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      project: {
        ...project,
        userRole: membership?.role || null,
      },
    });
  } catch (error) {
    console.error('Project by slug error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
