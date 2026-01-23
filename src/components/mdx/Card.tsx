// src/components/mdx/Card.tsx

import Link from 'next/link';
import { ArrowRight, LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';

interface CardProps {
  title: string;
  description: string;
  href: string;
  icon?: string;
}

export function Card({ title, description, href, icon }: CardProps) {
  const Icon = icon ? (Icons as Record<string, LucideIcon>)[icon] : null;

  return (
    <Link
      href={href}
      className="block glass-panel rounded-xl p-5 group hover:border-violet-spectral/30 transition-all duration-300"
    >
      {Icon && (
        <div className="p-2 rounded-lg bg-violet-spectral/15 w-fit mb-3">
          <Icon className="w-5 h-5 text-violet-spectral" strokeWidth={1.5} />
        </div>
      )}
      <h3 className="font-semibold text-white mb-1 group-hover:text-violet-ghost transition-colors">
        {title}
      </h3>
      <p className="text-sm text-gray-500 mb-3">{description}</p>
      <span className="text-sm text-violet-spectral flex items-center gap-1">
        Learn more <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
      </span>
    </Link>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
      {children}
    </div>
  );
}
