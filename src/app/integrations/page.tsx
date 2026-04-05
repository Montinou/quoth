import Link from 'next/link';
import { getAllIntegrations } from '@/lib/content/integrations';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { ArrowRight, Plug, Check } from 'lucide-react';
export const revalidate = 3600;

export default async function IntegrationsPage() {
  const integrations = await getAllIntegrations();

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12">
            <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-4">
              Integrations
            </h1>
            <p className="text-gray-400 text-lg max-w-2xl">
              Quoth works with any MCP-compatible client. Install the Quoth MCP server and connect persistent AI memory to your development environment in minutes.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {integrations.map(integration => (
              <Link
                key={integration.slug}
                href={`/integrations/${integration.slug}`}
                className="glass-panel rounded-xl p-6 group hover:border-violet-spectral/30 transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-violet-spectral/15">
                    <Plug className="w-5 h-5 text-violet-spectral" strokeWidth={1.5} />
                  </div>
                  <h2 className="text-lg font-semibold text-white group-hover:text-violet-ghost transition-colors">
                    {integration.client}
                  </h2>
                  {integration.supported && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
                      <Check className="w-3 h-3" /> Supported
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-3">{integration.description}</p>
                <span className="text-xs text-violet-spectral flex items-center gap-1">
                  Setup guide <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
            ))}
          </div>

          {integrations.length === 0 && (
            <div className="text-center py-16 glass-panel rounded-xl">
              <Plug className="w-12 h-12 text-gray-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-gray-500">Integration guides coming soon!</p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
