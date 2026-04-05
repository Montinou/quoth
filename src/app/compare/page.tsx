import Link from 'next/link';
import { getAllComparisons } from '@/lib/content/compare';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { ArrowRight, Scale } from 'lucide-react';
export const revalidate = 3600;

export default async function ComparePage() {
  const comparisons = await getAllComparisons();

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12">
            <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-4">
              Compare Quoth
            </h1>
            <p className="text-gray-400 text-lg max-w-2xl">
              Quoth is a multi-agent knowledge platform with persistent AI memory, semantic search, and agent-to-agent communication. See how it compares to other tools in the space.
            </p>
          </div>

          <div className="grid gap-4">
            {comparisons.map(comp => (
              <Link
                key={comp.slug}
                href={`/compare/${comp.slug}`}
                className="glass-panel rounded-xl p-6 group hover:border-violet-spectral/30 transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-violet-spectral/15">
                    <Scale className="w-5 h-5 text-violet-spectral" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white group-hover:text-violet-ghost transition-colors">
                      Quoth vs {comp.competitor}
                    </h2>
                    <p className="text-sm text-gray-500">{comp.description}</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-600 group-hover:text-violet-spectral group-hover:translate-x-1 transition-all" strokeWidth={1.5} />
              </Link>
            ))}
          </div>

          {comparisons.length === 0 && (
            <div className="text-center py-16 glass-panel rounded-xl">
              <Scale className="w-12 h-12 text-gray-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-gray-500">Comparisons coming soon!</p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
