"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: { image: 32, text: "text-xl" },
  md: { image: 40, text: "text-2xl" },
  lg: { image: 56, text: "text-4xl" },
};

export function Logo({ className, showText = true, size = "md" }: LogoProps) {
  const { image, text } = sizes[size];

  return (
    <div className={cn("flex items-center gap-3 group", className)}>
      <div className="relative flex items-center justify-center">
        {/* Subtle glow on hover */}
        <div className="absolute inset-0 bg-violet-spectral/20 rounded-lg blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500 scale-150" />

        <Image
          src="/logos/quoth-logo.png"
          alt="Quoth Logo"
          width={image}
          height={image}
          className="relative z-10 transition-transform duration-500 group-hover:scale-105"
          priority
        />
      </div>
      {showText && (
        <span
          className={cn(
            "font-medium italic tracking-wide text-white transition-colors duration-300 group-hover:text-violet-ghost",
            text
          )}
          style={{ fontFamily: "var(--font-cormorant), serif" }}
        >
          Quoth
        </span>
      )}
    </div>
  );
}
