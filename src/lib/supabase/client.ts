/**
 * Browser Supabase Client (Singleton)
 * For use in client components (with 'use client' directive)
 * Uses ANON key and manages auth via cookies
 * 
 * IMPORTANT: This uses a singleton pattern to prevent multiple client
 * instances causing race conditions and AbortErrors in production.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function createClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  supabaseClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  return supabaseClient;
}

