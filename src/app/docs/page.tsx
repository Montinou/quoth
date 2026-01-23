// src/app/docs/page.tsx

import { Metadata } from 'next';
import Link from 'next/link';
import { getDocsSidebar } from '@/lib/content/docs';
import { BookOpen, Zap, Code, BarChart, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Documentation | Quoth',
  description: 'Learn how to use Quoth - the documentation layer for AI-native development',
};

const sectionIcons: Record<string, typeof BookOpen> = {
  'getting-started': Zap,
  'guides': BookOpen,
  'reference': Code,
  'dashboard': BarChart,
};

export default async function DocsPage() {
  const sections = await getDocsSidebar();

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-bold font-cinzel text-white mb-4">
          Documentation
        </h1>
        <p className="text-gray-400 text-lg">
          Learn how to use Quoth to keep your AI in sync with your codebase.
        </p>
      </div>

      {/* Quick Start CTA */}
      <Link
        href="/docs/getting-started/quick-start"
        className="block glass-panel rounded-xl p-6 mb-12 group hover:border-violet-spectral/30 transition-all"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white mb-2 group-hover:text-violet-ghost transition-colors">
              Quick Start
            </h2>
            <p className="text-gray-400">Get Quoth running in 5 minutes</p>
          </div>
          <ArrowRight className="w-6 h-6 text-violet-spectral group-hover:translate-x-2 transition-transform" strokeWidth={1.5} />
        </div>
      </Link>

      {/* Sections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sections.map(section => {
          const Icon = sectionIcons[section.slug] || BookOpen;
          const firstPage = section.pages[0];

          return (
            <div key={section.slug} className="glass-panel rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-violet-spectral/15">
                  <Icon className="w-5 h-5 text-violet-spectral" strokeWidth={1.5} />
                </div>
                <h2 className="text-lg font-bold text-white">{section.title}</h2>
              </div>
              <ul className="space-y-2">
                {section.pages.map(page => (
                  <li key={page.slug.join('/')}>
                    <Link
                      href={`/docs/${page.slug.join('/')}`}
                      className="text-gray-400 hover:text-violet-ghost transition-colors text-sm flex items-center gap-2"
                    >
                      <span className="w-1 h-1 rounded-full bg-gray-600" />
                      {page.title}
                    </Link>
                  </li>
                ))}
              </ul>
              {firstPage && (
                <Link
                  href={`/docs/${firstPage.slug.join('/')}`}
                  className="inline-flex items-center gap-1 mt-4 text-sm text-violet-spectral hover:text-violet-ghost transition-colors"
                >
                  Get started <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {sections.length === 0 && (
        <div className="text-center py-16 glass-panel rounded-xl">
          <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-gray-500">Documentation coming soon!</p>
        </div>
      )}
    </div>
  );
}
