import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getComparisonBySlug, getAllComparisons } from '@/lib/content/compare';
import { MDXContent } from '@/components/mdx';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { ComparisonSchema, BreadcrumbSchema } from '@/components/SchemaMarkup';
import { ArrowLeft, Check, X, Minus } from 'lucide-react';
export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const comparisons = await getAllComparisons();
  return comparisons.map(c => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const comp = await getComparisonBySlug(slug);
  if (!comp) return { title: 'Not Found' };

  return {
    title: `Quoth vs ${comp.competitor}`,
    description: comp.description,
    alternates: { canonical: `https://quoth.triqual.dev/compare/${slug}` },
    openGraph: {
      title: `Quoth vs ${comp.competitor} — Feature Comparison`,
      description: comp.description,
      type: 'article',
    },
  };
}

function FeatureIcon({ value }: { value: string }) {
  const lower = value.toLowerCase();
  if (lower === 'yes' || lower === '✓') return <Check className="w-4 h-4 text-green-400" />;
  if (lower === 'no' || lower === '✗') return <X className="w-4 h-4 text-red-400" />;
  return <span className="text-sm text-gray-300">{value}</span>;
}

export default async function ComparisonPage({ params }: Props) {
  const { slug } = await params;
  const comp = await getComparisonBySlug(slug);
  if (!comp) notFound();

  const base = 'https://quoth.triqual.dev';

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />
      <ComparisonSchema
        title={`Quoth vs ${comp.competitor}`}
        description={comp.description}
        items={['Quoth', comp.competitor]}
        url={`${base}/compare/${slug}`}
      />
      <BreadcrumbSchema items={[
        { name: 'Home', url: base },
        { name: 'Compare', url: `${base}/compare` },
        { name: `Quoth vs ${comp.competitor}`, url: `${base}/compare/${slug}` },
      ]} />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <Link
            href="/compare"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-violet-ghost transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            All Comparisons
          </Link>

          <header className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold font-cinzel text-white mb-3">
              Quoth vs {comp.competitor}
            </h1>
            <p className="text-gray-400 text-lg">{comp.description}</p>
            <p className="text-xs text-gray-600 mt-2">Last updated: {new Date(comp.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          </header>

          {/* Feature Comparison Table */}
          {comp.features.length > 0 && (
            <div className="glass-panel rounded-xl overflow-hidden mb-10">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-4 text-sm font-medium text-gray-400">Feature</th>
                    <th className="text-center p-4 text-sm font-medium text-violet-ghost">Quoth</th>
                    <th className="text-center p-4 text-sm font-medium text-gray-400">{comp.competitor}</th>
                  </tr>
                </thead>
                <tbody>
                  {comp.features.map((f, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="p-4 text-sm text-gray-300">{f.name}</td>
                      <td className="p-4 text-center"><FeatureIcon value={f.quoth} /></td>
                      <td className="p-4 text-center"><FeatureIcon value={f.competitor} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pricing Comparison */}
          <div className="grid grid-cols-2 gap-4 mb-10">
            <div className="glass-panel rounded-xl p-6 border-violet-spectral/20">
              <h3 className="text-sm font-medium text-violet-ghost mb-2">Quoth Pricing</h3>
              <p className="text-white text-lg">{comp.pricing.quoth}</p>
            </div>
            <div className="glass-panel rounded-xl p-6">
              <h3 className="text-sm font-medium text-gray-400 mb-2">{comp.competitor} Pricing</h3>
              <p className="text-white text-lg">{comp.pricing.competitor}</p>
            </div>
          </div>

          {/* Verdict */}
          {comp.verdict && (
            <div className="glass-panel rounded-xl p-6 mb-10 border-violet-spectral/20">
              <h2 className="text-lg font-bold text-white mb-2">The Verdict</h2>
              <p className="text-gray-300">{comp.verdict}</p>
            </div>
          )}

          {/* MDX Content */}
          <div className="prose-quoth">
            <MDXContent source={comp.content} />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
