"use client";

import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  hover?: boolean;
}

export function GlassCard({
  icon: Icon,
  title,
  description,
  children,
  footer,
  hover = true,
  className,
  ...props
}: GlassCardProps) {
  return (
    <Card
      className={cn(
        "glass-panel border-white/5 relative overflow-hidden group",
        hover && "card-glow",
        className
      )}
      {...props}
    >
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-spectral/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10">
        {(Icon || title || description) && (
          <CardHeader className="pb-4">
            {Icon && (
              <div className="icon-container w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center mb-4 border border-white/5">
                <Icon
                  size={22}
                  strokeWidth={1.5}
                  className="text-gray-400 transition-all duration-500"
                />
              </div>
            )}
            {title && (
              <CardTitle
                className="font-serif text-lg sm:text-xl font-medium text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                {title}
              </CardTitle>
            )}
            {description && (
              <CardDescription className="text-gray-400 leading-relaxed font-light text-sm mt-2">
                {description}
              </CardDescription>
            )}
          </CardHeader>
        )}

        {children && <CardContent>{children}</CardContent>}

        {footer && <CardFooter>{footer}</CardFooter>}
      </div>
    </Card>
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
