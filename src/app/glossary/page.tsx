import Link from 'next/link';
import { getAllTerms } from '@/lib/content/glossary';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { BookOpen } from 'lucide-react';
export const revalidate = 3600;

export default async function GlossaryPage() {
  const terms = await getAllTerms();

  // Group by first letter
  const grouped = terms.reduce<Record<string, typeof terms>>((acc, term) => {
    const letter = term.term[0].toUpperCase();
    if (!acc[letter]) acc[letter] = [];
    acc[letter].push(term);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12">
            <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-4">
              AI &amp; MCP Glossary
            </h1>
            <p className="text-gray-400 text-lg max-w-2xl">
              Clear, concise definitions of key terms in AI development, Model Context Protocol, and knowledge management. Updated for 2026.
            </p>
          </div>

          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([letter, letterTerms]) => (
            <div key={letter} className="mb-8">
              <h2 className="text-2xl font-bold font-cinzel text-violet-spectral mb-4 pb-2 border-b border-violet-spectral/20">
                {letter}
              </h2>
              <div className="space-y-3">
                {letterTerms.map(term => (
                  <Link
                    key={term.slug}
                    href={`/glossary/${term.slug}`}
                    className="block glass-panel rounded-lg p-4 group hover:border-violet-spectral/30 transition-all"
                  >
                    <h3 className="font-semibold text-white group-hover:text-violet-ghost transition-colors">
                      {term.term}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">{term.definition}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {terms.length === 0 && (
            <div className="text-center py-16 glass-panel rounded-xl">
              <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-gray-500">Glossary terms coming soon!</p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
