/**
 * OAuth Callback Handler
 * 
 * Handles the callback after Supabase authentication,
 * generates authorization code, and redirects back to Claude.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getState, deleteState, saveAuthCode } from '@/lib/auth/oauth-state';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const oauthState = url.searchParams.get('oauth_state');
  const clientState = url.searchParams.get('client_state');
  const error = url.searchParams.get('error');
  
  if (error) {
    return errorRedirect(clientState, 'access_denied', 'User denied access');
  }

  if (!oauthState) {
    return errorRedirect(clientState, 'invalid_request', 'Missing oauth_state');
  }

  // Get stored OAuth state
  const state = getState(oauthState);
  if (!state) {
    return errorRedirect(clientState, 'invalid_request', 'Invalid or expired oauth_state');
  }

  // Get the authenticated user from Supabase session
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return errorRedirect(clientState, 'access_denied', 'Authentication failed');
  }

  // Get user's default project and role
  const { data: profile } = await supabase
    .from('profiles')
    .select('default_project_id')
    .eq('id', user.id)
    .single();

  const projectId = profile?.default_project_id || `${user.email?.split('@')[0]}-knowledge-base`;

  // Get user's role for this project
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  const role = membership?.role || 'viewer';

  // Generate authorization code
  const authorizationCode = crypto.randomUUID();
  
  // Store the auth code with user info
  saveAuthCode(authorizationCode, {
    client_id: state.client_id,
    redirect_uri: state.redirect_uri,
    code_challenge: state.code_challenge,
    code_challenge_method: state.code_challenge_method,
    user_id: user.id,
    project_id: projectId,
    role: role,
    created_at: Date.now(),
  });

  // Clean up the OAuth state
  deleteState(oauthState);

  // Redirect back to client with authorization code
  const redirectUrl = new URL(state.redirect_uri);
  redirectUrl.searchParams.set('code', authorizationCode);
  if (clientState) {
    redirectUrl.searchParams.set('state', clientState);
  }

  return NextResponse.redirect(redirectUrl.toString());
}

function errorRedirect(state: string | null, error: string, description: string) {
  // If we don't have a redirect URI, just show an error
  return NextResponse.json(
    { error, error_description: description },
    { status: 400 }
  );
}
