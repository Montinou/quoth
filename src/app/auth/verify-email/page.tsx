/**
 * Email Verification Page
 * Shown after signup, prompts user to verify email
 */

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4">
      <div className="glass-panel p-8 w-full max-w-md text-center">
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-violet-spectral/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-violet-spectral"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold font-cinzel mb-2">Check Your Email</h1>
          <p className="text-gray-400">
            We've sent you a verification link. Please check your inbox and click the link to verify your account.
          </p>
        </div>

        <div className="bg-charcoal/50 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-300 mb-2">What happens next:</p>
          <ol className="text-sm text-gray-400 text-left space-y-1">
            <li>1. Click the verification link in your email</li>
            <li>2. You'll be redirected back to Quoth</li>
            <li>3. Sign in with your credentials</li>
            <li>4. Access your dashboard and generate MCP tokens</li>
          </ol>
        </div>

        <p className="text-xs text-gray-500">
          Didn't receive an email? Check your spam folder or contact support.
        </p>
      </div>
    </div>
  );
}
