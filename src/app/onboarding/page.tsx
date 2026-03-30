/**
 * Onboarding Page — Server Component
 *
 * Checks auth + onboarding state in DB.
 * If completed, redirects to /dashboard.
 * Otherwise renders the client-side flow.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/connection';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { OnboardingFlow } from './onboarding-flow';

export const runtime = 'nodejs';

export default async function OnboardingPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/auth/cli');
  }

  const db = getDb();
  const [user] = await db
    .select({ metadata: users.metadata })
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (!user) {
    redirect('/auth/cli');
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
