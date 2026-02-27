"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

interface FooterProps {
  className?: string;
  links?: FooterLink[];
}

const defaultLinks: FooterLink[] = [
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/changelog", label: "Changelog" },
  { href: "/pricing", label: "Pricing" },
];

const ecosystemLinks: FooterLink[] = [
  { href: "https://triqual.dev", label: "Triqual Platform", external: true },
  { href: "https://voice.triqual.dev", label: "Voice Agents", external: true },
  { href: "https://studio.triqual.dev", label: "Studio", external: true },
  { href: "https://interview-companion.triqual.dev", label: "Interview Companion", external: true },
  { href: "https://exolar.triqual.dev", label: "Exolar QA", external: true },
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
        <div className="flex flex-col md:flex-row justify-between items-start gap-8">
          {/* Logo + Description */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <Logo />
            <p className="text-gray-600 text-xs max-w-xs text-center md:text-left">
              The arbiter of truth between your code and its documentation.
            </p>
          </div>

          {/* Product Links */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <p className="text-gray-500 text-xs font-mono uppercase tracking-wider">Product</p>
            <div className="flex flex-wrap justify-center md:justify-start gap-x-6 gap-y-2 text-sm text-gray-500">
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

          {/* Ecosystem Links */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <p className="text-gray-500 text-xs font-mono uppercase tracking-wider">Ecosystem</p>
            <div className="flex flex-wrap justify-center md:justify-start gap-x-6 gap-y-2 text-sm text-gray-500">
              {ecosystemLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-violet-ghost transition-colors relative group"
                >
                  {link.label}
                  <span className="absolute bottom-0 left-0 w-0 h-px bg-violet-spectral/50 group-hover:w-full transition-all duration-300" />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom section */}
        <div className="mt-10 sm:mt-12 pt-8 border-t border-white/5">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-center sm:text-left">
            <p className="text-gray-600 text-xs font-mono">
              &copy; {new Date().getFullYear()} Quoth Labs. &ldquo;Wisdom over Guesswork.&rdquo;
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <a href="https://triqual.dev" target="_blank" rel="noopener noreferrer" className="hover:text-violet-ghost transition-colors">
                A Triqual product
              </a>
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
