// src/emails/WeeklyHealthReportEmail.tsx
/**
 * Weekly Health Report Email Template
 * Sends documentation health summary to team members
 */

import { Text, Section, Hr, Link } from '@react-email/components';
import * as React from 'react';
import {
  QuothEmailLayout,
  QuothButton,
  emailStyles,
} from './QuothEmailLayout';

const { colors, heading, paragraph, smallText, divider } = emailStyles;

interface HealthMetrics {
  overallScore: number;
  totalDocs: number;
  freshDocs: number;
  agingDocs: number;
  staleDocs: number;
  criticalDocs: number;
}

interface DriftSummary {
  total: number;
  critical: number;
  warning: number;
  unresolvedCount: number;
}

interface MissRateMetrics {
  averageMissRate: number;
  trend: 'improving' | 'stable' | 'degrading';
  topMissedQueries: Array<{ query: string; missCount: number }>;
}

interface WeeklyHealthReportEmailProps {
  projectName: string;
  projectSlug: string;
  periodStart: string;
  periodEnd: string;
  health: HealthMetrics;
  drift: DriftSummary;
  missRate: MissRateMetrics;
  dashboardUrl: string;
}

export function WeeklyHealthReportEmail({
  projectName,
  projectSlug,
  periodStart,
  periodEnd,
  health,
  drift,
  missRate,
  dashboardUrl,
}: WeeklyHealthReportEmailProps) {
  const scoreColor = health.overallScore >= 80
    ? colors.violetGhost
    : health.overallScore >= 50
      ? '#FCD34D'
      : '#F87171';

  const trendEmoji = missRate.trend === 'improving'
    ? '📈'
    : missRate.trend === 'degrading'
      ? '📉'
      : '➡️';

  return (
    <QuothEmailLayout preview={`Weekly Health Report for ${projectName}`}>
      {/* Header */}
      <Text style={heading}>
        Weekly Documentation Health Report
      </Text>
      <Text style={{ ...paragraph, textAlign: 'center' as const }}>
        <span style={{ color: colors.violetGhost }}>{projectName}</span>
        <br />
        <span style={smallText}>{periodStart} — {periodEnd}</span>
      </Text>

      <Hr style={divider} />

      {/* Health Score */}
      <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
        <Text style={{ ...paragraph, fontSize: '14px', marginBottom: '8px' }}>
          Documentation Health Score
        </Text>
        <Text style={{
          fontSize: '48px',
          fontWeight: 'bold',
          color: scoreColor,
          margin: '0',
        }}>
          {health.overallScore}%
        </Text>
        <Text style={{ ...smallText, marginTop: '8px' }}>
          {health.freshDocs} fresh · {health.agingDocs} aging · {health.staleDocs} stale · {health.criticalDocs} critical
        </Text>
      </Section>

      <Hr style={divider} />

      {/* Drift Summary */}
      <Text style={{ ...paragraph, fontWeight: 600, marginBottom: '12px' }}>
        ⚠️ Drift Detection
      </Text>
      <table width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: '16px' }}>
        <tr>
          <td style={metricCell}>
            <Text style={metricValue}>{drift.unresolvedCount}</Text>
            <Text style={metricLabel}>Unresolved</Text>
          </td>
          <td style={metricCell}>
            <Text style={{ ...metricValue, color: '#F87171' }}>{drift.critical}</Text>
            <Text style={metricLabel}>Critical</Text>
          </td>
          <td style={metricCell}>
            <Text style={{ ...metricValue, color: '#FCD34D' }}>{drift.warning}</Text>
            <Text style={metricLabel}>Warnings</Text>
          </td>
        </tr>
      </table>

      <Hr style={divider} />

      {/* Miss Rate */}
      <Text style={{ ...paragraph, fontWeight: 600, marginBottom: '12px' }}>
        🔍 Search Miss Rate {trendEmoji}
      </Text>
      <Text style={paragraph}>
        <strong style={{ color: colors.violetGhost }}>{missRate.averageMissRate}%</strong> of searches returned no results
        <br />
        <span style={smallText}>
          Trend: {missRate.trend === 'improving' ? 'Improving' : missRate.trend === 'degrading' ? 'Needs attention' : 'Stable'}
        </span>
      </Text>

      {missRate.topMissedQueries.length > 0 && (
        <>
          <Text style={{ ...smallText, marginTop: '16px', marginBottom: '8px' }}>
            Top missed queries (consider documenting):
          </Text>
          <ul style={{ margin: '0', paddingLeft: '20px' }}>
            {missRate.topMissedQueries.slice(0, 5).map((q, i) => (
              <li key={i} style={{ ...smallText, marginBottom: '4px' }}>
                "{q.query}" ({q.missCount}x)
              </li>
            ))}
          </ul>
        </>
      )}

      <Hr style={divider} />

      {/* CTA */}
      <QuothButton href={dashboardUrl}>
        View Full Report
      </QuothButton>

      <Text style={{ ...smallText, textAlign: 'center' as const, marginTop: '16px' }}>
        This report is sent weekly to project admins.
        <br />
        <Link
          href={`${dashboardUrl}/settings`}
          style={{ color: colors.violetGhost }}
        >
          Manage notification preferences
        </Link>
      </Text>
    </QuothEmailLayout>
  );
}

// Helper styles
const metricCell: React.CSSProperties = {
  textAlign: 'center',
  padding: '8px',
};

const metricValue: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: colors.text,
  margin: '0',
};

const metricLabel: React.CSSProperties = {
  fontSize: '12px',
  color: colors.textMuted,
  margin: '4px 0 0 0',
};

export default WeeklyHealthReportEmail;
