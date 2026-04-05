import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Quoth Terms of Service. Usage terms, data handling, and intellectual property policies.',
  alternates: { canonical: 'https://quoth.triqual.dev/terms' },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
