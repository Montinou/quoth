"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  badge?: string;
  title: string;
  subtitle?: string;
  className?: string;
  children?: React.ReactNode;
}

export function PageHeader({
  badge,
  title,
  subtitle,
  className,
  children,
}: PageHeaderProps) {
  return (
    <section
      className={cn(
        "relative pt-32 pb-16 px-6 overflow-hidden",
        className
      )}
    >
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-spectral/5 rounded-full blur-[100px] -z-10" />

      <div className="max-w-4xl mx-auto text-center relative z-10">
        {badge && (
          <Badge
            variant="outline"
            className="mb-6 px-4 py-1.5 text-xs tracking-widest uppercase border-white/10 bg-white/5 text-violet-ghost"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-violet-spectral animate-pulse mr-2" />
            {badge}
          </Badge>
        )}

        <h1
          className="font-serif text-4xl md:text-6xl font-medium text-white leading-tight mb-6"
          style={{ fontFamily: "var(--font-cinzel), serif" }}
        >
          {title}
        </h1>

        {subtitle && (
          <p className="font-light text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            {subtitle}
          </p>
        )}

        {children}
      </div>
    </section>
  );
}
