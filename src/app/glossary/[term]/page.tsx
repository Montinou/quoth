import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTermBySlug, getAllTerms } from '@/lib/content/glossary';
import { MDXContent } from '@/components/mdx';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { DefinedTermSchema, BreadcrumbSchema } from '@/components/SchemaMarkup';
import { ArrowLeft } from 'lucide-react';
export const revalidate = 3600;

interface Props {
  params: Promise<{ term: string }>;
}

export async function generateStaticParams() {
  const terms = await getAllTerms();
  return terms.map(t => ({ term: t.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { term: slug } = await params;
  const term = await getTermBySlug(slug);
  if (!term) return { title: 'Not Found' };

  return {
    title: term.term,
    description: term.definition,
    alternates: { canonical: `https://quoth.triqual.dev/glossary/${slug}` },
  };
}

export default async function GlossaryTermPage({ params }: Props) {
  const { term: slug } = await params;
  const term = await getTermBySlug(slug);
  if (!term) notFound();

  const allTerms = await getAllTerms();
  const related = term.relatedTerms
    ?.map(rt => allTerms.find(t => t.slug === rt))
    .filter(Boolean) || [];

  const base = 'https://quoth.triqual.dev';

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />
      <DefinedTermSchema
        term={term.term}
        definition={term.definition}
        url={`${base}/glossary/${slug}`}
      />
      <BreadcrumbSchema items={[
        { name: 'Home', url: base },
        { name: 'Glossary', url: `${base}/glossary` },
        { name: term.term, url: `${base}/glossary/${slug}` },
      ]} />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <article className="max-w-3xl mx-auto">
          <Link
            href="/glossary"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-violet-ghost transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            Glossary
          </Link>

          <header className="mb-8">
            <span className="text-xs text-violet-spectral uppercase tracking-wider">{term.category}</span>
            <h1 className="text-3xl md:text-4xl font-bold font-cinzel text-white mt-2 mb-4">
              What is {term.term}?
            </h1>
            {/* AI-extractable definition block */}
            <div className="glass-panel rounded-xl p-6 border-violet-spectral/20">
              <p className="text-gray-300 text-lg leading-relaxed">
                <strong>{term.term}</strong> — {term.definition}
              </p>
            </div>
          </header>

          <div className="prose-quoth">
            <MDXContent source={term.content} />
          </div>

          {/* Related Terms */}
          {related.length > 0 && (
            <section className="mt-12 pt-8 border-t border-violet-spectral/20">
              <h2 className="text-lg font-bold font-cinzel text-white mb-4">Related Terms</h2>
              <div className="grid grid-cols-2 gap-3">
                {related.map(rt => rt && (
                  <Link
                    key={rt.slug}
                    href={`/glossary/${rt.slug}`}
                    className="glass-panel rounded-lg p-3 hover:border-violet-spectral/30 transition-all"
                  >
                    <span className="text-sm font-medium text-white">{rt.term}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>
      </main>

      <Footer />
    </div>
  );
}
