// src/components/docs/DocsSidebar.tsx

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';
import type { DocSection } from '@/lib/content/types';

interface DocsSidebarProps {
  sections: DocSection[];
}

export function DocsSidebar({ sections }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="w-64 shrink-0 hidden lg:block">
      <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pb-8 pr-4">
        {sections.map(section => (
          <div key={section.slug} className="mb-6">
            <h3 className="text-sm font-semibold text-white mb-2 px-3">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.pages.map(page => {
                const href = `/docs/${page.slug.join('/')}`;
                const isActive = pathname === href;

                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors',
                        isActive
                          ? 'bg-violet-spectral/15 text-violet-ghost border-l-2 border-violet-spectral'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      )}
                    >
                      <ChevronRight className={cn(
                        'w-3 h-3 transition-transform',
                        isActive && 'text-violet-spectral'
                      )} strokeWidth={1.5} />
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
