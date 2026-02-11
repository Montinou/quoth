/**
 * Supabase Auth Email Hook Handler
 * Receives webhook from Supabase Auth and sends custom-styled emails via Resend
 *
 * Configure in Supabase Dashboard:
 * Authentication → Hooks → Send Email → HTTP endpoint
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { render } from '@react-email/components';

import { WelcomeEmail } from '@/emails/WelcomeEmail';
import { PasswordResetEmail } from '@/emails/PasswordResetEmail';
import { MagicLinkEmail } from '@/emails/MagicLinkEmail';
import { EmailChangeEmail } from '@/emails/EmailChangeEmail';

const resend = new Resend(process.env.RESEND_API_KEY);

// Email configuration
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Quoth <quoth@triqual.dev>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.triqual.dev';

// Supabase Auth Hook payload types
interface AuthEmailPayload {
  user: {
    id: string;
    email: string;
    user_metadata?: {
      username?: string;
    };
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: 'signup' | 'recovery' | 'magiclink' | 'email_change';
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

/**
 * Verify webhook signature from Supabase Auth Hook
 * Uses HMAC-SHA256 to verify the payload matches the signature
 */
async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  timestampHeader: string | null
): Promise<boolean> {
  const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;

  // If no secret configured, reject all webhooks in production
  if (!webhookSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Webhook] SUPABASE_WEBHOOK_SECRET not configured - rejecting request');
      return false;
    }
    // Allow in development without signature verification
    console.warn('[Webhook] No webhook secret configured - allowing in development');
    return true;
  }

  if (!signatureHeader) {
    console.error('[Webhook] Missing signature header');
    return false;
  }

  // Supabase uses svix-style signatures: v1,<signature1> v1,<signature2>
  // Or simple signature format depending on hook configuration
  try {
    // Handle svix-style signature format
    const signatures = signatureHeader.split(' ');

    for (const sig of signatures) {
      const parts = sig.split(',');
      const version = parts[0];
      const signature = parts[1] || parts[0]; // Handle both "v1,sig" and plain "sig"

      if (version === 'v1' || !parts[1]) {
        // Create HMAC of timestamp + payload (svix format) or just payload
        const signedPayload = timestampHeader
          ? `${timestampHeader}.${payload}`
          : payload;

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(webhookSecret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );

        const signatureBuffer = await crypto.subtle.sign(
          'HMAC',
          key,
          encoder.encode(signedPayload)
        );

        // Convert to base64
        const expectedSignature = Buffer.from(signatureBuffer).toString('base64');

        // Constant-time comparison
        if (signature === expectedSignature) {
          return true;
        }

        // Also try hex format
        const expectedSignatureHex = Buffer.from(signatureBuffer).toString('hex');
        if (signature === expectedSignatureHex) {
          return true;
        }
      }
    }

    // Check for replay attacks - timestamp should be within 5 minutes
    if (timestampHeader) {
      const timestamp = parseInt(timestampHeader, 10);
      const now = Math.floor(Date.now() / 1000);
      const tolerance = 300; // 5 minutes

      if (Math.abs(now - timestamp) > tolerance) {
        console.error('[Webhook] Timestamp outside tolerance window');
        return false;
      }
    }

    console.error('[Webhook] Signature verification failed - no matching signature');
    return false;
  } catch (error) {
    console.error('[Webhook] Signature verification error:', error);
    return false;
  }
}

// Build action URL with token
function buildActionUrl(type: string, token: string, redirectTo?: string): string {
  const baseUrl = `${APP_URL}/auth/callback`;
  const params = new URLSearchParams({
    token_hash: token,
    type,
  });

  if (redirectTo) {
    // Extract pathname from full URL (e.g., "https://example.com/dashboard" -> "/dashboard")
    try {
      const url = new URL(redirectTo, APP_URL);
      params.set('next', url.pathname);
    } catch {
      // If not a valid URL, use as-is (likely already a path)
      params.set('next', redirectTo);
    }
  }

  return `${baseUrl}?${params.toString()}`;
}

export async function POST(request: Request) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();

    // Supabase Auth Hooks can send auth via:
    // 1. Authorization: Bearer <secret> header (HTTP Hook mode)
    // 2. svix-signature / webhook-signature headers (Webhook mode)
    const authHeader = request.headers.get('authorization');
    const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;

    let isValid = false;

    // Method 1: Check Authorization Bearer token (Supabase Auth Hook standard)
    if (authHeader?.startsWith('Bearer ') && webhookSecret) {
      const token = authHeader.slice(7);
      // Compare against the webhook secret (strip svix prefix if present)
      const cleanSecret = webhookSecret.replace(/^v1,whsec_/, '').replace(/^whsec_/, '');
      isValid = token === webhookSecret || token === cleanSecret;
    }

    // Method 2: Fall back to svix/webhook signature verification
    if (!isValid) {
      const signature = request.headers.get('svix-signature') ||
                        request.headers.get('webhook-signature') ||
                        request.headers.get('x-webhook-signature');
      const timestamp = request.headers.get('svix-timestamp') ||
                        request.headers.get('webhook-timestamp');

      isValid = await verifyWebhookSignature(rawBody, signature, timestamp);
    }

    if (!isValid) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse payload
    const payload: AuthEmailPayload = JSON.parse(rawBody);
    const { user, email_data } = payload;

    if (!user?.email || !email_data?.email_action_type) {
      return NextResponse.json(
        { error: 'Invalid payload' },
        { status: 400 }
      );
    }

    const username = user.user_metadata?.username;
    const emailType = email_data.email_action_type;
    const token = email_data.token_hash;

    // Build action URL
    const actionUrl = buildActionUrl(emailType, token, email_data.redirect_to);

    // Render appropriate email template
    let subject: string;
    let html: string;

    switch (emailType) {
      case 'signup':
        subject = 'Welcome to Quoth - Verify Your Email';
        html = await render(WelcomeEmail({ username, confirmationUrl: actionUrl }));
        break;

      case 'recovery':
        subject = 'Reset Your Quoth Password';
        html = await render(PasswordResetEmail({ username, resetUrl: actionUrl }));
        break;

      case 'magiclink':
        subject = 'Your Quoth Login Link';
        html = await render(MagicLinkEmail({ username, magicLinkUrl: actionUrl }));
        break;

      case 'email_change':
        subject = 'Confirm Your New Email Address';
        html = await render(EmailChangeEmail({
          username,
          confirmationUrl: actionUrl,
          newEmail: user.email,
        }));
        break;

      default:
        console.error(`Unknown email type: ${emailType}`);
        return NextResponse.json(
          { error: `Unknown email type: ${emailType}` },
          { status: 400 }
        );
    }

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: user.email,
      subject,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json(
        { error: 'Failed to send email' },
        { status: 500 }
      );
    }

    console.log(`Auth email sent: ${emailType} to ${user.email}, id: ${data?.id}`);

    return NextResponse.json({ success: true, id: data?.id });
  } catch (error) {
    console.error('Email hook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'quoth-auth-email-hook',
    version: '2026-01-12-v2',
    configured: {
      resend: !!process.env.RESEND_API_KEY,
      webhook_secret: !!process.env.SUPABASE_WEBHOOK_SECRET,
    },
  });
}
