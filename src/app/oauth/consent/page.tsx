/**
 * OAuth Consent Screen
 * Displays authorization request details and allows user to approve/deny
 * Used with Supabase OAuth Server
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Check, X, AlertCircle, Loader2 } from 'lucide-react';

interface AuthorizationDetails {
  client_id: string;
  client_name?: string;
  redirect_uri: string;
  scopes: string[];
  state?: string;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: 'Verify your identity',
  email: 'View your email address',
  profile: 'View your basic profile information',
  phone: 'View your phone number',
  'mcp:read': 'Search and read documentation',
  'mcp:write': 'Propose documentation updates',
  'mcp:admin': 'Full administrative access',
};

function ConsentForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authDetails, setAuthDetails] = useState<AuthorizationDetails | null>(null);

  const authorizationId = searchParams.get('authorization_id');

  useEffect(() => {
    let mounted = true;

    async function fetchAuthorizationDetails() {
      if (!authorizationId) {
        if (mounted) {
          setError('Missing authorization_id parameter');
          setLoading(false);
        }
        return;
      }

      try {
        const supabase = createClient();

        // Check if user is logged in - with retry for abort race condition
        let user = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const { data, error: userError } = await supabase.auth.getUser();
          if (!mounted) return;

          // If aborted, wait and retry
          if (userError?.message?.includes('aborted') || userError?.message?.includes('signal')) {
            await new Promise(resolve => setTimeout(resolve, 150));
            continue;
          }
          user = data?.user;
          break;
        }

        if (!user) {
          // Redirect to login with return URL
          const returnUrl = `/oauth/consent?authorization_id=${authorizationId}`;
          router.push(`/auth/login?redirectTo=${encodeURIComponent(returnUrl)}`);
          return;
        }

        // Get authorization details from Supabase OAuth
        const { data, error: oauthError } =
          await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

        if (!mounted) return;

        if (oauthError || !data) {
          setError(oauthError?.message || 'Failed to get authorization details');
          setLoading(false);
          return;
        }

        // Extract client info from Supabase OAuth response
        const client = data.client as { id?: string; name?: string } | undefined;
        setAuthDetails({
          client_id: client?.id || 'unknown',
          client_name: client?.name || client?.id || 'Unknown Application',
          redirect_uri: (data as { redirect_uri?: string }).redirect_uri || '',
          scopes: (data as { scopes?: string[] }).scopes || [],
          state: (data as { state?: string }).state,
        });
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        // Ignore abort errors
        if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
          return;
        }
        setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        setLoading(false);
      }
    }

    fetchAuthorizationDetails();

    return () => {
      mounted = false;
    };
  }, [authorizationId, router]);

  async function handleApprove() {
    if (!authorizationId) return;

    setProcessing(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: approveError } =
        await supabase.auth.oauth.approveAuthorization(authorizationId);

      if (approveError) {
        setError(approveError.message);
        setProcessing(false);
        return;
      }

      // Supabase handles the redirect automatically after approval
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve authorization');
      setProcessing(false);
    }
  }

  async function handleDeny() {
    if (!authorizationId) return;

    setProcessing(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: denyError } =
        await supabase.auth.oauth.denyAuthorization(authorizationId);

      if (denyError) {
        setError(denyError.message);
        setProcessing(false);
        return;
      }

      // Supabase handles the redirect automatically after denial
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny authorization');
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
        <div className="flex items-center gap-3 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading authorization details...</span>
        </div>
      </div>
    );
  }

  if (error && !authDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4">
        <Card className="glass-panel border-red-500/20 max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <AlertCircle className="w-6 h-6" />
              <span className="font-medium">Authorization Error</span>
            </div>
            <p className="text-gray-400 text-sm">{error}</p>
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={() => router.push('/dashboard')}
            >
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!authDetails) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal px-4 py-8">
      <Card className="glass-panel max-w-md w-full">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-violet-spectral/20 flex items-center justify-center">
            <Shield className="w-8 h-8 text-violet-spectral" />
          </div>
          <CardTitle className="text-2xl font-cinzel">Authorization Request</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Client Info */}
          <div className="text-center">
            <p className="text-gray-400 text-sm">
              <span className="text-violet-ghost font-medium">
                {authDetails.client_name}
              </span>{' '}
              wants to access your Quoth account
            </p>
          </div>

          {/* Requested Permissions */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">
              This application will be able to:
            </h3>
            <ul className="space-y-2">
              {authDetails.scopes.map((scope) => (
                <li
                  key={scope}
                  className="flex items-center gap-3 text-sm text-gray-400 bg-charcoal/50 rounded-lg px-3 py-2"
                >
                  <Check className="w-4 h-4 text-emerald-muted flex-shrink-0" />
                  <span>{SCOPE_DESCRIPTIONS[scope] || scope}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Redirect URI Info */}
          <div className="text-xs text-gray-500 bg-charcoal/30 rounded-lg p-3">
            <p>
              After authorization, you will be redirected to:
              <br />
              <code className="text-violet-ghost/70 break-all">
                {authDetails.redirect_uri}
              </code>
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleDeny}
              disabled={processing}
            >
              {processing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <X className="w-4 h-4 mr-2" />
                  Deny
                </>
              )}
            </Button>
            <Button className="flex-1" onClick={handleApprove} disabled={processing}>
              {processing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Authorize
                </>
              )}
            </Button>
          </div>

          {/* Security Notice */}
          <p className="text-xs text-gray-500 text-center">
            Only authorize applications you trust. You can revoke access at any time from
            your dashboard.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-obsidian to-charcoal">
          <div className="flex items-center gap-3 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading...</span>
          </div>
        </div>
      }
    >
      <ConsentForm />
    </Suspense>
  );
}
