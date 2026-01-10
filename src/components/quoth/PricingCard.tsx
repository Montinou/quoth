"use client";

import { Check } from "lucide-react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PricingFeature {
  text: string;
  included: boolean;
}

interface PricingCardProps {
  name: string;
  description: string;
  price: string;
  period?: string;
  features: PricingFeature[];
  cta: string;
  highlighted?: boolean;
  badge?: string;
  className?: string;
  onCtaClick?: () => void;
}

export function PricingCard({
  name,
  description,
  price,
  period = "/month",
  features,
  cta,
  highlighted = false,
  badge,
  className,
  onCtaClick,
}: PricingCardProps) {
  return (
    <Card
      className={cn(
        "glass-panel border-white/5 relative overflow-hidden",
        highlighted && "border-violet-spectral/50 card-glow",
        className
      )}
    >
      {highlighted && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-spectral to-violet-glow" />
      )}

      <CardHeader className="text-center pb-2">
        {badge && (
          <Badge
            className="absolute top-4 right-4 bg-violet-spectral/20 text-violet-ghost border-violet-spectral/50"
          >
            {badge}
          </Badge>
        )}

        <h3
          className="font-serif text-2xl font-medium text-white"
          style={{ fontFamily: "var(--font-cinzel), serif" }}
        >
          {name}
        </h3>
        <p className="text-gray-500 text-sm font-light">{description}</p>

        <div className="pt-4">
          <span className="text-4xl font-bold text-white">{price}</span>
          {price !== "Custom" && (
            <span className="text-gray-500 text-sm">{period}</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <ul className="space-y-3">
          {features.map((feature, index) => (
            <li
              key={index}
              className={cn(
                "flex items-start gap-3 text-sm",
                feature.included ? "text-gray-300" : "text-gray-600"
              )}
            >
              <Check
                size={16}
                strokeWidth={1.5}
                className={cn(
                  "mt-0.5 flex-shrink-0",
                  feature.included
                    ? "text-emerald-muted"
                    : "text-gray-700"
                )}
              />
              <span>{feature.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="pt-6">
        <Button
          onClick={onCtaClick}
          variant={highlighted ? "default" : "outline"}
          className={cn(
            "w-full",
            highlighted
              ? "bg-violet-spectral hover:bg-violet-glow"
              : "border-white/10 hover:border-violet-spectral/50"
          )}
        >
          {cta}
        </Button>
      </CardFooter>
    </Card>
  );
}
