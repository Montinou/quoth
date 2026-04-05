import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Compare Quoth',
    template: '%s | Quoth Compare',
  },
  description: 'Compare Quoth with other AI memory and MCP tools. Feature-by-feature comparisons to help you choose the right solution.',
  alternates: { canonical: 'https://quoth.triqual.dev/compare' },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
