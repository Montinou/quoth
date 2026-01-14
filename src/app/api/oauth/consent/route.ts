/**
 * OAuth Consent API Route
 *
 * Server-side handler for OAuth consent flow to avoid React StrictMode
 * and AuthContext AbortController conflicts.
 *
 * GET: Fetch authorization details
 * POST: Approve or deny authorization
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

// GET: Fetch authorization details
export async function GET(request: NextRequest) {
  const authorizationId = request.nextUrl.searchParams.get('authorization_id');

  if (!authorizationId) {
    return NextResponse.json(
      { error: 'Missing authorization_id' },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const supabase = await createServerSupabaseClient();

    // Check if user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'not_authenticated', redirectTo: '/auth/login' },
        { status: 401, headers: corsHeaders }
      );
    }

    // Get authorization details from Supabase OAuth
    console.log('[OAuth Consent API] Fetching authorization details for:', authorizationId);

    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

    console.log('[OAuth Consent API] Response:', { data, error });

    if (error) {
      console.error('[OAuth Consent API] Error:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'No authorization details returned' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Extract client info from Supabase OAuth response
    const client = (data as { client?: { id?: string; name?: string } }).client;

    // Return authorization details
    return NextResponse.json({
      client_id: client?.id || 'unknown',
      client_name: client?.name || client?.id || 'Unknown Application',
      redirect_uri: (data as { redirect_uri?: string }).redirect_uri || '',
      scopes: (data as { scopes?: string[] }).scopes || [],
      state: (data as { state?: string }).state,
    }, { headers: corsHeaders });

  } catch (err) {
    console.error('[OAuth Consent API] Unexpected error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

// POST: Approve or deny authorization
export async function POST(request: NextRequest) {
  try {
    const { authorization_id, action } = await request.json();

    if (!authorization_id || !['approve', 'deny'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid request - requires authorization_id and action (approve/deny)' },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = await createServerSupabaseClient();

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401, headers: corsHeaders }
      );
    }

    console.log(`[OAuth Consent API] User ${user.id} ${action}ing authorization:`, authorization_id);

    if (action === 'approve') {
      const { data, error } = await supabase.auth.oauth.approveAuthorization(authorization_id);
      console.log('[OAuth Consent API] Approve response - full data:', JSON.stringify(data, null, 2));
      console.log('[OAuth Consent API] Approve response - error:', error);
      if (error) {
        console.error('[OAuth Consent API] Approve error:', error);
        return NextResponse.json({ error: error.message }, { status: 400, headers: corsHeaders });
      }
      console.log('[OAuth Consent API] Authorization approved');

      // Try to find redirect URL in various possible locations
      const dataObj = data as Record<string, unknown>;
      const redirectUrl = dataObj?.redirect_uri ||
                          dataObj?.redirect_to ||
                          dataObj?.url ||
                          dataObj?.callback_url ||
                          (dataObj as { redirect?: string })?.redirect;

      console.log('[OAuth Consent API] Extracted redirect URL:', redirectUrl);
      console.log('[OAuth Consent API] All data keys:', data ? Object.keys(data) : 'no data');

      return NextResponse.json({
        success: true,
        redirect_uri: redirectUrl,
        // Include full data for debugging
        _debug_data: data
      }, { headers: corsHeaders });
    } else {
      const { data, error } = await supabase.auth.oauth.denyAuthorization(authorization_id);
      console.log('[OAuth Consent API] Deny response - full data:', JSON.stringify(data, null, 2));
      if (error) {
        console.error('[OAuth Consent API] Deny error:', error);
        return NextResponse.json({ error: error.message }, { status: 400, headers: corsHeaders });
      }
      console.log('[OAuth Consent API] Authorization denied');

      // Try to find redirect URL in various possible locations
      const dataObj = data as Record<string, unknown>;
      const redirectUrl = dataObj?.redirect_uri ||
                          dataObj?.redirect_to ||
                          dataObj?.url ||
                          dataObj?.callback_url ||
                          (dataObj as { redirect?: string })?.redirect;

      return NextResponse.json({
        success: true,
        redirect_uri: redirectUrl,
        _debug_data: data
      }, { headers: corsHeaders });
    }

  } catch (err) {
    console.error('[OAuth Consent API] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
