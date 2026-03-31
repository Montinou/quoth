/**
 * /dashboard/team — redirects to the user's default project team page
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/connection';
import { sql } from 'drizzle-orm';

export default async function TeamRedirect() {
  const { userId } = await auth();
  if (!userId) redirect('/');

  const db = getDb();

  // Find user's default project slug
  const rows = await db.execute<{ slug: string }>(sql`
    SELECT p.slug
    FROM public.projects p
    INNER JOIN public.users u ON u.default_project_id = p.id
    WHERE u.clerk_user_id = ${userId}
    LIMIT 1
  `);

  const slug = (rows.rows[0] as { slug: string } | undefined)?.slug;

  if (slug) {
    redirect(`/dashboard/${slug}/team`);
  }

  // No default project — redirect to dashboard
  redirect('/dashboard');
}
