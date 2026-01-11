/**
 * Magic Link Email Template
 * Sent for passwordless login
 */

import { Hr, Text } from '@react-email/components';
import * as React from 'react';
import { QuothEmailLayout, QuothButton, emailStyles } from './QuothEmailLayout';

interface MagicLinkEmailProps {
  username?: string;
  magicLinkUrl: string;
}

export function MagicLinkEmail({ username, magicLinkUrl }: MagicLinkEmailProps) {
  const displayName = username || 'there';

  return (
    <QuothEmailLayout preview="Your Quoth login link">
      <Text style={emailStyles.heading}>
        Sign In to Quoth
      </Text>

      <Text style={emailStyles.paragraph}>
        Hi <span style={emailStyles.highlight}>{displayName}</span>,
      </Text>

      <Text style={emailStyles.paragraph}>
        Click the button below to securely sign in to your Quoth account.
        No password needed!
      </Text>

      <QuothButton href={magicLinkUrl}>
        Sign In
      </QuothButton>

      <Hr style={emailStyles.divider} />

      <Text style={emailStyles.smallText}>
        If you didn't request this login link, you can safely ignore this email.
        Someone may have typed your email address by mistake.
      </Text>

      <Text style={emailStyles.smallText}>
        This link will expire in 1 hour and can only be used once.
      </Text>
    </QuothEmailLayout>
  );
}

export default MagicLinkEmail;
