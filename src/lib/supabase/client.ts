/**
 * Browser Supabase Client
 * For use in client components (with 'use client' directive)
 * Uses ANON key and manages auth via cookies
 */

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
