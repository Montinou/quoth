import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getIntegrationBySlug, getAllIntegrations } from '@/lib/content/integrations';
import { MDXContent } from '@/components/mdx';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { BreadcrumbSchema, HowToSchema } from '@/components/SchemaMarkup';
import { ArrowLeft, Check } from 'lucide-react';
export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const integrations = await getAllIntegrations();
  return integrations.map(i => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const integration = await getIntegrationBySlug(slug);
  if (!integration) return { title: 'Not Found' };

  return {
    title: `Quoth + ${integration.client}`,
    description: integration.description,
    alternates: { canonical: `https://quoth.triqual.dev/integrations/${slug}` },
    openGraph: {
      title: `How to Use Quoth with ${integration.client}`,
      description: integration.description,
    },
  };
}

export default async function IntegrationPage({ params }: Props) {
  const { slug } = await params;
  const integration = await getIntegrationBySlug(slug);
  if (!integration) notFound();

  const base = 'https://quoth.triqual.dev';

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />
      <BreadcrumbSchema items={[
        { name: 'Home', url: base },
        { name: 'Integrations', url: `${base}/integrations` },
        { name: integration.client, url: `${base}/integrations/${slug}` },
      ]} />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <article className="max-w-3xl mx-auto">
          <Link
            href="/integrations"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-violet-ghost transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            All Integrations
          </Link>

          <header className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold font-cinzel text-white mb-3">
              Quoth + {integration.client}
            </h1>
            <p className="text-gray-400 text-lg">{integration.description}</p>
            <p className="text-xs text-gray-600 mt-2">Last updated: {new Date(integration.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          </header>

          {/* Supported Features */}
          {integration.features.length > 0 && (
            <div className="glass-panel rounded-xl p-6 mb-8">
              <h2 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Supported Features</h2>
              <ul className="grid grid-cols-2 gap-2">
                {integration.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                    <Check className="w-4 h-4 text-green-400 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="prose-quoth">
            <MDXContent source={integration.content} />
          </div>
        </article>
      </main>

      <Footer />
    </div>
  );
}
