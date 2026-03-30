/**
 * Login Page — Clerk Sign-In
 */
import { SignIn } from '@clerk/nextjs';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <SignIn
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
