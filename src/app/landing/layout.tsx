import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Welcome',
  description: 'Quoth: The AI-driven MCP server that enforces consistency between your codebase and documentation. Stop hallucinations. Enforce your architecture.',
  openGraph: {
    title: 'Quoth | The Living Source of Truth',
    description: 'The arbiter of truth between your code and its documentation. Stoic. Precise. Unyielding. Wisdom over Guesswork.',
  },
  alternates: { canonical: 'https://quoth.triqual.dev/landing' },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
