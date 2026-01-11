/**
 * Password Reset Email Template
 * Sent when a user requests to reset their password
 */

import { Hr, Text } from '@react-email/components';
import * as React from 'react';
import { QuothEmailLayout, QuothButton, emailStyles } from './QuothEmailLayout';

interface PasswordResetEmailProps {
  username?: string;
  resetUrl: string;
}

export function PasswordResetEmail({ username, resetUrl }: PasswordResetEmailProps) {
  const displayName = username || 'there';

  return (
    <QuothEmailLayout preview="Reset your Quoth password">
      <Text style={emailStyles.heading}>
        Reset Your Password
      </Text>

      <Text style={emailStyles.paragraph}>
        Hi <span style={emailStyles.highlight}>{displayName}</span>,
      </Text>

      <Text style={emailStyles.paragraph}>
        We received a request to reset the password for your Quoth account.
        Click the button below to create a new password:
      </Text>

      <QuothButton href={resetUrl}>
        Reset Password
      </QuothButton>

      <Hr style={emailStyles.divider} />

      <Text style={emailStyles.smallText}>
        If you didn't request a password reset, you can safely ignore this email.
        Your password will remain unchanged.
      </Text>

      <Text style={emailStyles.smallText}>
        This link will expire in 1 hour for security reasons.
      </Text>
    </QuothEmailLayout>
  );
}

export default PasswordResetEmail;
