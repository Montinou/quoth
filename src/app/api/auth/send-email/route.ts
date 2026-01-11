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
import { createHmac } from 'crypto';

import { WelcomeEmail } from '@/emails/WelcomeEmail';
import { PasswordResetEmail } from '@/emails/PasswordResetEmail';
import { MagicLinkEmail } from '@/emails/MagicLinkEmail';
import { EmailChangeEmail } from '@/emails/EmailChangeEmail';

const resend = new Resend(process.env.RESEND_API_KEY);

// Email configuration
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Quoth <noreply@ai-innovation.site>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';

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

// Verify webhook signature from Supabase
function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET;

  // Skip verification if no secret configured (development)
  if (!secret) {
    console.warn('SUPABASE_WEBHOOK_SECRET not configured - skipping signature verification');
    return true;
  }

  if (!signature) {
    return false;
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

// Build action URL with token
function buildActionUrl(type: string, token: string, redirectTo?: string): string {
  const baseUrl = `${APP_URL}/auth/callback`;
  const params = new URLSearchParams({
    token_hash: token,
    type,
  });

  if (redirectTo) {
    params.set('next', redirectTo);
  }

  return `${baseUrl}?${params.toString()}`;
}

export async function POST(request: Request) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature');

    // Verify signature
    if (!verifyWebhookSignature(rawBody, signature)) {
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
    configured: {
      resend: !!process.env.RESEND_API_KEY,
      webhook_secret: !!process.env.SUPABASE_WEBHOOK_SECRET,
    },
  });
}
