/**
 * OAuth State Store
 * Stores PKCE challenges and state for OAuth flow
 */

interface OAuthState {
  code_challenge: string;
  code_challenge_method: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  created_at: number;
  // Supabase session reference
  supabase_session_id?: string;
}

// In-memory store for OAuth state (in production, use Redis)
const stateStore = new Map<string, OAuthState>();

// Store authorization codes and their associated data
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

const authCodes = new Map<string, AuthCode>();

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  const stateMaxAge = 10 * 60 * 1000; // 10 minutes
  const codeMaxAge = 5 * 60 * 1000; // 5 minutes
  
  for (const [key, state] of stateStore) {
    if (now - state.created_at > stateMaxAge) {
      stateStore.delete(key);
    }
  }
  
  for (const [key, code] of authCodes) {
    if (now - code.created_at > codeMaxAge) {
      authCodes.delete(key);
    }
  }
}, 60 * 1000);

export function saveState(state: string, data: OAuthState) {
  stateStore.set(state, data);
}

export function getState(state: string): OAuthState | undefined {
  return stateStore.get(state);
}

export function deleteState(state: string) {
  stateStore.delete(state);
}

export function saveAuthCode(code: string, data: AuthCode) {
  authCodes.set(code, data);
}

export function getAuthCode(code: string): AuthCode | undefined {
  return authCodes.get(code);
}

export function deleteAuthCode(code: string) {
  authCodes.delete(code);
}
