/**
 * OAuth Consent Screen
 * Displays authorization request details and allows user to approve/deny
 * Uses server-side API route to avoid React StrictMode/AuthContext conflicts
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
        // Use server-side API route to avoid React StrictMode/AuthContext conflicts
        console.log('[Consent] Fetching authorization details via API for:', authorizationId);

        const response = await fetch(`/api/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
        const data = await response.json();

        if (!mounted) return;

        console.log('[Consent] API response:', data);

        // Handle not authenticated - redirect to login
        if (data.error === 'not_authenticated') {
          const returnUrl = `/oauth/consent?authorization_id=${authorizationId}`;
          router.push(`/auth/login?redirectTo=${encodeURIComponent(returnUrl)}`);
          return;
        }

        // Handle other errors
        if (data.error) {
          setError(data.error);
          setLoading(false);
          return;
        }

        // Set authorization details
        setAuthDetails({
          client_id: data.client_id || 'unknown',
          client_name: data.client_name || 'Unknown Application',
          redirect_uri: data.redirect_uri || '',
          scopes: data.scopes || [],
          state: data.state,
        });
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        console.error('[Consent] Fetch error:', err);
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
      // Call Supabase directly from browser - this triggers the redirect automatically
      const supabase = createClient();
      console.log('[Consent] Calling approveAuthorization directly from browser');

      const { error } = await supabase.auth.oauth.approveAuthorization(authorizationId);

      if (error) {
        console.error('[Consent] Approve error:', error);
        setError(error.message);
        setProcessing(false);
        return;
      }

      // If we get here without a redirect, Supabase should have redirected
      // Wait a moment then show message
      console.log('[Consent] Approval successful, waiting for redirect...');
      setTimeout(() => {
        setError('Authorization approved. If not redirected, please close this window.');
        setProcessing(false);
      }, 3000);
    } catch (err) {
      // Ignore AbortError - it might happen but the approval could still work
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[Consent] AbortError during approve (may still succeed)');
        setTimeout(() => {
          setError('Authorization may have succeeded. If not redirected, please try again.');
          setProcessing(false);
        }, 2000);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to approve authorization');
      setProcessing(false);
    }
  }

  async function handleDeny() {
    if (!authorizationId) return;

    setProcessing(true);
    setError(null);

    try {
      // Call Supabase directly from browser - this triggers the redirect automatically
      const supabase = createClient();
      console.log('[Consent] Calling denyAuthorization directly from browser');

      const { error } = await supabase.auth.oauth.denyAuthorization(authorizationId);

      if (error) {
        console.error('[Consent] Deny error:', error);
        setError(error.message);
        setProcessing(false);
        return;
      }

      // If we get here without a redirect, go to dashboard
      console.log('[Consent] Denial successful, waiting for redirect...');
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (err) {
      // Ignore AbortError
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[Consent] AbortError during deny');
        router.push('/dashboard');
        return;
      }
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
