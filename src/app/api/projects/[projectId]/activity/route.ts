/**
 * Activity API Endpoint
 * GET: Fetch activity summary for dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getActivitySummary } from '@/lib/quoth/activity';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { projectId } = await params;
    const supabase = await createServerSupabaseClient();

    // Verify user has access to project
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get activity summary (default: last 7 days)
    const days = parseInt(request.nextUrl.searchParams.get('days') || '7');
    const activity = await getActivitySummary(projectId, days);

    return NextResponse.json({ activity });
  } catch (error) {
    console.error('[Activity API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity' },
      { status: 500 }
    );
  }
}
