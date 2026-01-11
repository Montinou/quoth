/**
 * Email Integration Module
 * Handles email notifications via Resend for proposal approvals/rejections and team invitations
 */

import { Resend } from 'resend';
import { render } from '@react-email/render';
import { TeamInvitationEmail } from '@/emails/TeamInvitationEmail';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Quoth Guardian <quoth@ai-innovation.site>';
const RECIPIENTS = (process.env.EMAIL_RECIPIENTS || '').split(',').filter(Boolean);

export interface CommitResult {
  sha?: string;
  url?: string;
}

/**
 * Sends email notification when a proposal is approved and committed
 * @param proposal - The approved proposal
 * @param commit - GitHub commit information
 */
export async function sendApprovalNotification(proposal: any, commit: CommitResult) {
  if (!isResendConfigured()) {
    console.warn('Resend not configured. Skipping email notification.');
    return;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: RECIPIENTS,
      subject: `[Quoth] Auto-Updated: ${proposal.file_path}`,
      html: generateApprovalEmail(proposal, commit)
    });
    console.log(`Approval email sent for proposal ${proposal.id}`);
  } catch (error) {
    console.error('Failed to send approval email:', error);
    // Don't throw - email failures shouldn't block the approval workflow
  }
}

/**
 * Sends email notification when a proposal is rejected
 * @param proposal - The rejected proposal
 * @param reason - Rejection reason provided by reviewer
 */
export async function sendRejectionNotification(proposal: any, reason: string) {
  if (!isResendConfigured()) {
    console.warn('Resend not configured. Skipping email notification.');
    return;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: RECIPIENTS,
      subject: `[Quoth] Proposal Rejected: ${proposal.file_path}`,
      html: generateRejectionEmail(proposal, reason)
    });
    console.log(`Rejection email sent for proposal ${proposal.id}`);
  } catch (error) {
    console.error('Failed to send rejection email:', error);
  }
}

/**
 * Generates HTML email template for approved proposals
 */
function generateApprovalEmail(proposal: any, commit: CommitResult): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      padding: 20px;
      margin: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 30px;
    }
    .header {
      color: #8B5CF6;
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .section {
      background: #262626;
      padding: 15px;
      border-radius: 5px;
      margin: 15px 0;
    }
    .label {
      color: #9ca3af;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 5px;
    }
    .value {
      color: #e5e5e5;
      margin-top: 5px;
      line-height: 1.5;
    }
    .code {
      background: #0a0a0a;
      padding: 10px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .button {
      display: inline-block;
      background: #8B5CF6;
      color: white;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 5px;
      margin: 10px 5px 0 0;
      font-weight: 600;
    }
    .button:hover {
      background: #7C3AED;
    }
    .footer {
      margin-top: 30px;
      font-size: 12px;
      color: #6b7280;
      border-top: 1px solid #333;
      padding-top: 15px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">✅ Quoth Autonomous Action</div>

    <p>The Quoth proposal has been approved and applied to the knowledge base:</p>

    <div class="section">
      <div class="label">File Updated</div>
      <div class="value"><strong>${escapeHtml(proposal.file_path)}</strong></div>
    </div>

    <div class="section">
      <div class="label">Why?</div>
      <div class="value">${escapeHtml(proposal.reasoning)}</div>
    </div>

    ${proposal.evidence_snippet ? `
    <div class="section">
      <div class="label">Evidence</div>
      <div class="code">${escapeHtml(proposal.evidence_snippet)}</div>
    </div>
    ` : ''}

    <div class="section">
      <div class="label">Commit</div>
      <div class="value">
        SHA: <code>${commit.sha?.substring(0, 7) || 'N/A'}</code><br/>
        <a href="${commit.url || '#'}" class="button">View Diff on GitHub</a>
      </div>
    </div>

    <div class="footer">
      <strong>Proposal ID:</strong> ${proposal.id}<br/>
      <strong>Approved at:</strong> ${new Date().toISOString()}<br/>
      <strong>Reviewed by:</strong> ${proposal.reviewed_by || 'System'}<br/><br/>
      This action was performed automatically. If incorrect, revert the commit in GitHub.
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generates HTML email template for rejected proposals
 */
function generateRejectionEmail(proposal: any, reason: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      padding: 20px;
      margin: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 30px;
    }
    .header {
      color: #ef4444;
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .section {
      background: #262626;
      padding: 15px;
      border-radius: 5px;
      margin: 15px 0;
    }
    .label {
      color: #9ca3af;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 5px;
    }
    .value {
      color: #e5e5e5;
      margin-top: 5px;
      line-height: 1.5;
    }
    .rejection-reason {
      color: #fca5a5;
      font-weight: 500;
    }
    .footer {
      margin-top: 30px;
      font-size: 12px;
      color: #6b7280;
      border-top: 1px solid #333;
      padding-top: 15px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">❌ Proposal Rejected</div>

    <p>A documentation update proposal was reviewed and rejected:</p>

    <div class="section">
      <div class="label">File</div>
      <div class="value"><strong>${escapeHtml(proposal.file_path)}</strong></div>
    </div>

    <div class="section">
      <div class="label">Original Reasoning</div>
      <div class="value">${escapeHtml(proposal.reasoning)}</div>
    </div>

    <div class="section">
      <div class="label">Rejection Reason</div>
      <div class="value rejection-reason">${escapeHtml(reason)}</div>
    </div>

    <div class="footer">
      <strong>Proposal ID:</strong> ${proposal.id}<br/>
      <strong>Rejected at:</strong> ${new Date().toISOString()}<br/>
      <strong>Reviewed by:</strong> ${proposal.reviewed_by || 'System'}
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Escapes HTML to prevent XSS in email content
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Checks if Resend is properly configured
 */
export function isResendConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && RECIPIENTS.length > 0);
}

/**
 * Auth email types supported by the webhook handler
 */
export type AuthEmailType = 'signup' | 'recovery' | 'magiclink' | 'email_change';

/**
 * Auth email subjects map
 */
export const AUTH_EMAIL_SUBJECTS: Record<AuthEmailType, string> = {
  signup: 'Welcome to Quoth - Verify Your Email',
  recovery: 'Reset Your Quoth Password',
  magiclink: 'Your Quoth Login Link',
  email_change: 'Confirm Your New Email Address',
};

/**
 * Team invitation email params
 */
export interface TeamInvitationParams {
  email: string;
  projectName: string;
  inviterName: string;
  role: string;
  token: string;
}

/**
 * Sends team invitation email
 * @param params - Invitation details
 */
export async function sendTeamInvitationEmail(params: TeamInvitationParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('Resend not configured. Skipping invitation email.');
    return;
  }

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://quoth.ai-innovation.site';
  const acceptUrl = `${APP_URL}/invitations/accept?token=${params.token}`;

  try {
    const html = await render(
      TeamInvitationEmail({
        projectName: params.projectName,
        inviterName: params.inviterName,
        role: params.role,
        acceptUrl,
      })
    );

    await resend.emails.send({
      from: FROM_EMAIL,
      to: params.email,
      subject: `You've been invited to join ${params.projectName} on Quoth`,
      html,
    });

    console.log(`Invitation email sent to ${params.email}`);
  } catch (error) {
    console.error('Failed to send invitation email:', error);
    // Don't throw - email failures shouldn't block the invitation workflow
  }
}
