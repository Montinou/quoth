/**
 * Proposals API - List Endpoint
 * GET /api/proposals - List all proposals with optional filters
 */

import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Use RPC function for efficient querying with JOINs
    const { data, error } = await supabase.rpc('get_proposals_with_details', {
      filter_status: status,
      limit_count: limit
    });

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
