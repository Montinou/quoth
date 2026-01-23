"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

interface FooterLink {
  href: string;
  label: string;
}

interface FooterProps {
  className?: string;
  links?: FooterLink[];
}

const defaultLinks: FooterLink[] = [
  { href: "/manifesto", label: "Manifesto" },
  { href: "/protocol", label: "Protocol" },
  { href: "/guide", label: "Guide" },
  { href: "/pricing", label: "Pricing" },
];

export function Footer({ className, links = defaultLinks }: FooterProps) {
  return (
    <footer
      className={cn(
        "relative border-t border-white/5 py-12 sm:py-16 px-4 sm:px-6 bg-obsidian",
        className
      )}
    >
      {/* Subtle top gradient */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-spectral/20 to-transparent" />

      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          {/* Logo */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <Logo />
            <p className="text-gray-600 text-xs max-w-xs text-center md:text-left">
              The arbiter of truth between your code and its documentation.
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap justify-center gap-6 sm:gap-8 text-sm text-gray-500">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-violet-ghost transition-colors relative group"
              >
                {link.label}
                <span className="absolute bottom-0 left-0 w-0 h-px bg-violet-spectral/50 group-hover:w-full transition-all duration-300" />
              </Link>
            ))}
          </div>
        </div>

        {/* Bottom section */}
        <div className="mt-10 sm:mt-12 pt-8 border-t border-white/5">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-center sm:text-left">
            <p className="text-gray-600 text-xs font-mono">
              &copy; {new Date().getFullYear()} Quoth Labs. &ldquo;Wisdom over Guesswork.&rdquo;
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-muted animate-pulse" />
                All systems operational
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
