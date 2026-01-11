/**
 * OAuth State Store - Cookie-based
 * 
 * Uses encrypted cookies to store PKCE challenges and state for OAuth flow.
 * This works on serverless platforms like Vercel where in-memory stores
 * don't persist across function invocations.
 */

import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET!;

interface OAuthState {
  code_challenge: string;
  code_challenge_method: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  created_at: number;
}

interface AuthCode {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  user_id: string;
  project_id: string;
  role: string;
  created_at: number;
}

/**
 * Encode OAuth state as a signed JWT for cookie storage
 */
export async function encodeState(data: OAuthState): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT(data as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m') // State expires in 10 minutes
    .sign(secret);
}

/**
 * Decode OAuth state from signed JWT
 */
export async function decodeState(token: string): Promise<OAuthState | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return {
      code_challenge: payload.code_challenge as string,
      code_challenge_method: payload.code_challenge_method as string,
      client_id: payload.client_id as string,
      redirect_uri: payload.redirect_uri as string,
      scope: payload.scope as string | undefined,
      created_at: payload.created_at as number,
    };
  } catch {
    return null;
  }
}

/**
 * Encode authorization code data as signed JWT
 */
export async function encodeAuthCode(data: AuthCode): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT(data as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m') // Auth codes expire in 5 minutes
    .sign(secret);
}

/**
 * Decode authorization code from signed JWT
 */
export async function decodeAuthCode(token: string): Promise<AuthCode | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return {
      client_id: payload.client_id as string,
      redirect_uri: payload.redirect_uri as string,
      code_challenge: payload.code_challenge as string,
      code_challenge_method: payload.code_challenge_method as string,
      user_id: payload.user_id as string,
      project_id: payload.project_id as string,
      role: payload.role as string,
      created_at: payload.created_at as number,
    };
  } catch {
    return null;
  }
}
