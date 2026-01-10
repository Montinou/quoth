"use client";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: { svg: 24, text: "text-xl" },
  md: { svg: 32, text: "text-2xl" },
  lg: { svg: 48, text: "text-4xl" },
};

export function Logo({ className, showText = true, size = "md" }: LogoProps) {
  const { svg, text } = sizes[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex items-center justify-center">
        <svg
          width={svg}
          height={svg}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M22.5 4H9.5C8.11929 4 7 5.11929 7 6.5V26.5L10.5 23H22.5C23.8807 23 25 21.8807 25 20.5V6.5C25 5.11929 23.8807 4 22.5 4Z"
            stroke="#8B5CF6"
            strokeWidth="2"
          />
          <rect
            x="14"
            y="16"
            width="6"
            height="6"
            fill="#8B5CF6"
            fillOpacity="0.2"
            stroke="#8B5CF6"
          />
          <path
            d="M12 28L15 25"
            stroke="#8B5CF6"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {showText && (
        <span
          className={cn(
            "font-serif font-bold tracking-wider text-white",
            text
          )}
          style={{ fontFamily: "var(--font-cinzel), serif" }}
        >
          QUOTH
        </span>
      )}
    </div>
  );
}
