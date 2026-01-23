/**
 * Coverage API Endpoint
 * GET: Fetch latest coverage snapshot
 * POST: Trigger new coverage scan
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  calculateCoverage,
  saveCoverageSnapshot,
  getLatestCoverage,
} from '@/lib/quoth/coverage';
import { logActivity } from '@/lib/quoth/activity';

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

    // Get latest coverage
    const coverage = await getLatestCoverage(projectId);

    if (!coverage) {
      return NextResponse.json({
        coverage: null,
        message: 'No coverage data available. Trigger a scan to calculate coverage.',
      });
    }

    return NextResponse.json({ coverage });
  } catch (error) {
    console.error('[Coverage API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch coverage' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // Parse optional codebase paths from request body
    const body = await request.json().catch(() => ({}));
    const codebasePaths = body.paths as string[] | undefined;

    // Calculate coverage
    const coverage = await calculateCoverage(projectId, codebasePaths);

    // Save snapshot
    await saveCoverageSnapshot(coverage, 'manual');

    // Log activity
    await logActivity({
      projectId,
      userId: user.id,
      eventType: 'coverage_scan',
      resultCount: coverage.totalDocumented,
      context: {
        percentage: coverage.coveragePercentage,
        totalDocumentable: coverage.totalDocumentable,
      },
    });

    return NextResponse.json({
      coverage,
      message: 'Coverage scan completed',
    });
  } catch (error) {
    console.error('[Coverage API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate coverage' },
      { status: 500 }
    );
  }
}
