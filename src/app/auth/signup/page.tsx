/**
 * Signup Page — Clerk Sign-Up
 */
import { SignUp } from '@clerk/nextjs';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <SignUp
        appearance={{
          elements: {
            rootBox: 'mx-auto',
            card: 'bg-zinc-900 border border-zinc-800',
          },
        }}
        routing="hash"
        fallbackRedirectUrl="/dashboard"
      />
    </div>
  );
}
