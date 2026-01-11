/**
 * Proposals API - Detail Endpoint
 * GET /api/proposals/:id - Get single proposal with all details
 * Requires authentication and project access
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch proposal
    const { data, error } = await supabase
      .from('document_proposals')
      .select(`
        *,
        documents (
          id,
          title,
          file_path
        )
      `)
      .eq('id', id)
      .single();

    if (error || !data) {
      return Response.json(
        { error: 'Proposal not found' },
        { status: 404 }
      );
    }

    // 3. Verify user has access to the proposal's project
    const { data: membership, error: membershipError } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', data.project_id)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return Response.json(
        { error: 'Access denied. You are not a member of this project.' },
        { status: 403 }
      );
    }

    return Response.json({ proposal: data });
  } catch (error) {
    console.error('Error fetching proposal:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
