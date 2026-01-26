'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function signOutAction() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()

  // Explicitly clear Supabase auth cookies
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()

  // Clear all Supabase auth cookies (they start with 'sb-')
  for (const cookie of allCookies) {
    if (cookie.name.startsWith('sb-')) {
      cookieStore.delete(cookie.name)
    }
  }

  redirect('/')
}
