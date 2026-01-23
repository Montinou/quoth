// src/app/docs/[...slug]/page.tsx

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDocBySlug, getDocsSidebar, getAdjacentDocs } from '@/lib/content/docs';
import { MDXContent } from '@/components/mdx';
import { TableOfContents } from '@/components/docs/TableOfContents';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  params: Promise<{ slug: string[] }>;
}

export async function generateStaticParams() {
  const sections = await getDocsSidebar();
  return sections.flatMap(section =>
    section.pages.map(page => ({ slug: page.slug }))
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) return { title: 'Page Not Found' };

  return {
    title: `${doc.title} | Quoth Docs`,
    description: doc.description,
  };
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) notFound();

  const { prev, next } = await getAdjacentDocs(slug);

  return (
    <div className="flex gap-8">
      {/* Main Content */}
      <article className="flex-1 min-w-0 max-w-3xl">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/docs" className="hover:text-violet-ghost transition-colors">
            Docs
          </Link>
          {slug.map((part, i) => (
            <span key={i} className="flex items-center gap-2">
              <ChevronRight className="w-3 h-3" />
              <span className={i === slug.length - 1 ? 'text-gray-300' : ''}>
                {part.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </span>
            </span>
          ))}
        </nav>

        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-cinzel text-white mb-3">
            {doc.title}
          </h1>
          <p className="text-gray-400 text-lg">
            {doc.description}
          </p>
        </header>

        {/* Content */}
        <div className="prose-quoth">
          <MDXContent source={doc.content} />
        </div>

        {/* Prev/Next Navigation */}
        <nav className="flex items-center justify-between mt-12 pt-6 border-t border-violet-spectral/20">
          {prev ? (
            <Link
              href={`/docs/${prev.slug.join('/')}`}
              className="flex items-center gap-2 text-gray-400 hover:text-violet-ghost transition-colors"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
              <div>
                <div className="text-xs text-gray-600">Previous</div>
                <div className="font-medium">{prev.title}</div>
              </div>
            </Link>
          ) : <div />}
          {next ? (
            <Link
              href={`/docs/${next.slug.join('/')}`}
              className="flex items-center gap-2 text-gray-400 hover:text-violet-ghost transition-colors text-right"
            >
              <div>
                <div className="text-xs text-gray-600">Next</div>
                <div className="font-medium">{next.title}</div>
              </div>
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </Link>
          ) : <div />}
        </nav>
      </article>

      {/* Table of Contents */}
      <TableOfContents headings={doc.headings} />
    </div>
  );
}
