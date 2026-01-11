/**
 * OAuth Authorization Endpoint
 * 
 * Handles the OAuth authorization flow:
 * 1. Validates client and PKCE parameters
 * 2. Redirects to Supabase login page
 * 3. After login, redirects back with authorization code
 * 
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { saveState } from '@/lib/auth/oauth-state';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function GET(req: Request) {
  const url = new URL(req.url);
  
  // Extract OAuth parameters
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const state = url.searchParams.get('state');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
  const scope = url.searchParams.get('scope');

  // Validate required parameters
  if (!clientId) {
    return errorResponse('invalid_request', 'client_id is required');
  }
  if (!redirectUri) {
    return errorResponse('invalid_request', 'redirect_uri is required');
  }
  if (responseType !== 'code') {
    return errorResponse('unsupported_response_type', 'Only code response type is supported');
  }
  if (!codeChallenge) {
    return errorResponse('invalid_request', 'code_challenge is required (PKCE)');
  }
  if (codeChallengeMethod !== 'S256') {
    return errorResponse('invalid_request', 'Only S256 code_challenge_method is supported');
  }

  // Generate our own state to track this OAuth flow
  const oauthState = crypto.randomUUID();
  
  // Store the OAuth state for later verification
  saveState(oauthState, {
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope || undefined,
    created_at: Date.now(),
  });

  // Build the login page URL with OAuth state
  // We'll use our own login page that handles Supabase auth
  const loginUrl = new URL(`${APP_URL}/auth/oauth-login`);
  loginUrl.searchParams.set('oauth_state', oauthState);
  loginUrl.searchParams.set('client_state', state || '');
  
  return NextResponse.redirect(loginUrl.toString());
}

function errorResponse(error: string, description: string) {
  return NextResponse.json(
    { error, error_description: description },
    { status: 400 }
  );
}
