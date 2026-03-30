/**
 * Onboarding Page — Server Component
 *
 * Checks auth + onboarding state in DB.
 * If completed, redirects to /dashboard.
 * Otherwise renders the client-side flow.
 */

import { auth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/connection';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { OnboardingFlow } from './onboarding-flow';


export default async function OnboardingPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/auth/cli');
  }

  const db = getDb();
  let [user] = await db
    .select({ metadata: users.metadata })
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  // User may not exist yet if Clerk webhook hasn't fired.
  // Create a user record with proper data from Clerk so onboarding can proceed.
  if (!user) {
    // Fetch user info from Clerk to populate email + name
    let email = '';
    let displayName: string | null = null;
    try {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      email = clerkUser.emailAddresses?.[0]?.emailAddress ?? '';
      displayName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;
    } catch {
      // Clerk fetch failed — proceed with empty values, webhook will fix later
    }

    await db
      .insert(users)
      .values({
        clerkUserId: userId,
        email,
        displayName,
        metadata: { onboarding_step: 0, onboarding_completed: false, onboarding_data: {} },
      })
      .onConflictDoNothing();

    // Re-fetch to get the inserted row
    [user] = await db
      .select({ metadata: users.metadata })
      .from(users)
      .where(eq(users.clerkUserId, userId))
      .limit(1);

    if (!user) {
      // Shouldn't happen, but prevent infinite redirect
      return <OnboardingFlow initialStep={0} initialData={{}} />;
    }
  }

  const meta = (user.metadata ?? {}) as Record<string, unknown>;
  const completed = meta.onboarding_completed === true;

  if (completed) {
    redirect('/dashboard');
  }

  const initialStep = typeof meta.onboarding_step === 'number' ? meta.onboarding_step : 0;
  const initialData = (meta.onboarding_data as Record<string, string>) ?? {};

  return <OnboardingFlow initialStep={initialStep} initialData={initialData} />;
}
