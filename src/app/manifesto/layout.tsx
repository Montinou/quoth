import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Manifesto',
  description: 'The Quoth Manifesto: Our philosophy on documentation-driven development. Why documentation should be the single source of truth for AI code generation.',
  openGraph: {
    title: 'The Quoth Manifesto | Philosophy of Truth',
    description: 'Documentation-driven development philosophy. Why your docs should be the arbiter of truth between code and architecture.',
  },
  alternates: { canonical: 'https://quoth.triqual.dev/manifesto' },
};

export default function ManifestoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
