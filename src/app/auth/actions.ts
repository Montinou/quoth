'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function signOutAction() {
  // Clear any legacy Supabase cookies
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('sb-')) {
      cookieStore.delete(cookie.name);
    }
  }
  redirect('/');
}
