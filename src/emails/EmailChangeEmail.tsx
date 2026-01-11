/**
 * Email Change Verification Template
 * Sent when a user changes their email address
 */

import { Hr, Text } from '@react-email/components';
import * as React from 'react';
import { QuothEmailLayout, QuothButton, emailStyles } from './QuothEmailLayout';

interface EmailChangeEmailProps {
  username?: string;
  confirmationUrl: string;
  newEmail: string;
}

export function EmailChangeEmail({ username, confirmationUrl, newEmail }: EmailChangeEmailProps) {
  const displayName = username || 'there';

  return (
    <QuothEmailLayout preview="Confirm your new email address for Quoth">
      <Text style={emailStyles.heading}>
        Confirm Email Change
      </Text>

      <Text style={emailStyles.paragraph}>
        Hi <span style={emailStyles.highlight}>{displayName}</span>,
      </Text>

      <Text style={emailStyles.paragraph}>
        You requested to change your Quoth account email to:
      </Text>

      <Text style={emailStyles.codeBlock}>
        {newEmail}
      </Text>

      <Text style={emailStyles.paragraph}>
        Click the button below to confirm this change:
      </Text>

      <QuothButton href={confirmationUrl}>
        Confirm Email
      </QuothButton>

      <Hr style={emailStyles.divider} />

      <Text style={emailStyles.smallText}>
        If you didn't request this email change, please contact support immediately
        as someone may have access to your account.
      </Text>

      <Text style={emailStyles.smallText}>
        This link will expire in 24 hours.
      </Text>
    </QuothEmailLayout>
  );
}

export default EmailChangeEmail;
