/**
 * Proposals API - List Endpoint
 * GET /api/proposals - List all proposals with optional filters
 * Requires authentication - returns only proposals from user's projects
 */

import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get user's projects
    const { data: projects, error: projectsError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', user.id);

    if (projectsError) {
      console.error('Error fetching user projects:', projectsError);
      return Response.json(
        { error: 'Failed to fetch user projects' },
        { status: 500 }
      );
    }

    const projectIds = projects?.map((p) => p.project_id) || [];

    if (projectIds.length === 0) {
      // User has no projects, return empty list
      return Response.json({ proposals: [] });
    }

    // 3. Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');

    // 4. Fetch proposals filtered by user's projects
    // RLS policies will automatically filter to user's accessible projects
    let query = supabase
      .from('document_proposals')
      .select(`
        *,
        documents (
          id,
          title,
          file_path,
          project_id
        )
      `)
      .in('project_id', projectIds)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching proposals:', error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ proposals: data || [] });
  } catch (error) {
    console.error('Unexpected error in proposals API:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
