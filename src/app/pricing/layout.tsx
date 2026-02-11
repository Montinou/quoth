import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Quoth pricing plans: Free tier with 50 documents, Pro at $29/month with unlimited documents, and Enterprise with custom integrations.',
  openGraph: {
    title: 'Quoth Pricing | Plans for Every Team',
    description: 'Choose your Quoth plan. Free for individuals, Pro for teams, Enterprise for organizations requiring full control.',
  },
  alternates: { canonical: 'https://quoth.triqual.dev/pricing' },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
