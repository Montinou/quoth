// src/app/changelog/page.tsx

import { Metadata } from 'next';
import { getAllChangelogs, groupChangelogsByMonth, formatChangelogDate } from '@/lib/content/changelog';
import { MDXContent } from '@/components/mdx';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { Rss } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Changelog | Quoth',
  description: 'Track the evolution of Quoth - new features, improvements, and fixes',
};

export default async function ChangelogPage() {
  const entries = await getAllChangelogs();
  const grouped = groupChangelogsByMonth(entries);

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-12">
            <div>
              <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-4">
                Changelog
              </h1>
              <p className="text-gray-400 text-lg">
                Track Quoth&apos;s evolution
              </p>
            </div>
            <a
              href="/changelog/rss.xml"
              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-violet-ghost glass-panel rounded-lg transition-colors"
            >
              <Rss className="w-4 h-4" strokeWidth={1.5} />
              RSS
            </a>
          </div>

          {/* Timeline */}
          {Object.entries(grouped).map(([monthYear, monthEntries]) => (
            <div key={monthYear} className="mb-12">
              {/* Month Header */}
              <h2 className="text-lg font-semibold text-gray-500 mb-6 pb-2 border-b border-violet-spectral/20">
                {monthYear}
              </h2>

              {/* Entries */}
              <div className="space-y-8">
                {monthEntries.map((entry, index) => {
                  const { month, day } = formatChangelogDate(entry.date);

                  return (
                    <div key={entry.date + index} className="flex gap-6">
                      {/* Date Column */}
                      <div className="w-16 shrink-0 text-center">
                        <div className="text-sm text-gray-500">{month}</div>
                        <div className="text-2xl font-bold text-white">{day}</div>
                        {/* Timeline dot and line */}
                        <div className="relative mt-3">
                          <div className="w-3 h-3 rounded-full bg-violet-spectral mx-auto" />
                          {index < monthEntries.length - 1 && (
                            <div className="absolute left-1/2 -translate-x-1/2 top-3 w-px h-full bg-violet-spectral/20" style={{ height: 'calc(100% + 2rem)' }} />
                          )}
                        </div>
                      </div>

                      {/* Content Column */}
                      <div className="flex-1 glass-panel rounded-xl p-6">
                        {/* Version badge and title */}
                        <div className="flex items-center gap-3 mb-4">
                          {entry.version && (
                            <span className="px-3 py-1 text-sm font-mono font-medium rounded-full bg-violet-spectral/20 text-violet-ghost border border-violet-spectral/30">
                              v{entry.version}
                            </span>
                          )}
                          {entry.title && (
                            <h3 className="text-xl font-bold text-white">{entry.title}</h3>
                          )}
                        </div>

                        {/* MDX Content */}
                        <div className="prose-quoth text-sm [&>h2]:text-base [&>h2]:mt-4 [&>h2]:mb-2 [&>ul]:my-2">
                          <MDXContent source={entry.content} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Empty State */}
          {entries.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-500">No changelog entries yet.</p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
