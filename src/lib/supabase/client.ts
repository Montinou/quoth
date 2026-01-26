/**
 * Browser Supabase Client
 * For use in client components (with 'use client' directive)
 * Uses ANON key and manages auth via cookies
 *
 * IMPORTANT: Uses singleton pattern to prevent AbortError in React 18 Strict Mode.
 * Multiple client instances cause auth lock conflicts when components double-mount.
 */

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton instance - prevents multiple clients from fighting for auth lock
let browserClient: SupabaseClient | null = null

export function createClient() {
  if (browserClient) {
    return browserClient
  }

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  return browserClient
}
