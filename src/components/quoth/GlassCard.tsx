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
        "glass-panel border-white/5",
        hover && "card-glow",
        className
      )}
      {...props}
    >
      {(Icon || title || description) && (
        <CardHeader>
          {Icon && (
            <div className="icon-container w-12 h-12 rounded bg-white/5 flex items-center justify-center mb-4 transition-all duration-300">
              <Icon
                size={20}
                strokeWidth={1.5}
                className="text-gray-400 transition-all duration-300"
              />
            </div>
          )}
          {title && (
            <CardTitle
              className="font-serif text-xl font-medium text-white"
              style={{ fontFamily: "var(--font-cinzel), serif" }}
            >
              {title}
            </CardTitle>
          )}
          {description && (
            <CardDescription className="text-gray-400 leading-relaxed font-light text-sm">
              {description}
            </CardDescription>
          )}
        </CardHeader>
      )}

      {children && <CardContent>{children}</CardContent>}

      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
