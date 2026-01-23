// src/components/docs/TableOfContents.tsx

'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { DocHeading } from '@/lib/content/types';

interface TableOfContentsProps {
  headings: DocHeading[];
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-80px 0px -80% 0px' }
    );

    headings.forEach(heading => {
      const element = document.getElementById(heading.slug);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav className="w-56 shrink-0 hidden xl:block">
      <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
        <h4 className="text-sm font-semibold text-white mb-3">On this page</h4>
        <ul className="space-y-2 text-sm">
          {headings.map(heading => (
            <li
              key={heading.slug}
              style={{ paddingLeft: `${(heading.level - 2) * 0.75}rem` }}
            >
              <a
                href={`#${heading.slug}`}
                className={cn(
                  'block py-1 transition-colors',
                  activeId === heading.slug
                    ? 'text-violet-ghost'
                    : 'text-gray-500 hover:text-gray-300'
                )}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
