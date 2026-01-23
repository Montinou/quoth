// src/components/mdx/Card.tsx

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CheckCircle,
  Folder,
  GitPullRequest,
  Key,
  Minimize2,
  RefreshCw,
  Search,
  Shield,
  Users,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CardProps {
  title: string;
  description: string;
  href: string;
  icon?: string;
}

// Static map of available icons to avoid dynamic component creation
const iconMap: Record<string, LucideIcon> = {
  BookOpen,
  CheckCircle,
  Folder,
  GitPullRequest,
  Key,
  Minimize2,
  RefreshCw,
  Search,
  Shield,
  Users,
  Wrench,
};

// Icon wrapper component - avoids dynamic component creation during render
function CardIcon({ name }: { name: string }) {
  const IconComponent = iconMap[name];
  if (!IconComponent) return null;
  return <IconComponent className="w-5 h-5 text-violet-spectral" strokeWidth={1.5} />;
}

export function Card({ title, description, href, icon }: CardProps) {
  return (
    <Link
      href={href}
      className="block glass-panel rounded-xl p-5 group hover:border-violet-spectral/30 transition-all duration-300"
    >
      {icon && iconMap[icon] && (
        <div className="p-2 rounded-lg bg-violet-spectral/15 w-fit mb-3">
          <CardIcon name={icon} />
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
