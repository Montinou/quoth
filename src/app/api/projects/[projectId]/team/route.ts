/**
 * Team Members API
 * GET /api/projects/:projectId/team - List team members
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createServerSupabaseClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Verify user has access to project
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // 3. Fetch team members with profile info
    const { data: members, error } = await supabase
      .from('project_members')
      .select(
        `
        id,
        role,
        created_at,
        profiles:user_id (
          id,
          email,
          username,
          full_name,
          avatar_url
        )
      `
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch team members:', error);
      return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
    }

    return NextResponse.json({
      members,
      currentUserRole: membership.role,
    });
  } catch (error) {
    console.error('Team API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
