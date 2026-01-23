// src/app/docs/layout.tsx

import { getDocsSidebar } from '@/lib/content/docs';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { DocsSidebar } from '@/components/docs/DocsSidebar';

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sections = await getDocsSidebar();

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />

      <div className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex gap-8">
          <DocsSidebar sections={sections} />
          <main className="flex-1 min-w-0">
            {children}
          </main>
        </div>
      </div>

      <Footer />
    </div>
  );
}
