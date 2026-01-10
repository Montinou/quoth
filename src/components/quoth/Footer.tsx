"use client";

import Link from "next/link";
import { Github, Twitter } from "lucide-react";
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
  { href: "/pricing", label: "Pricing" },
];

export function Footer({ className, links = defaultLinks }: FooterProps) {
  return (
    <footer
      className={cn(
        "border-t border-white/5 py-12 px-6 bg-obsidian",
        className
      )}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <Logo />

          <div className="flex gap-8 text-sm text-gray-500">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hover:text-violet-ghost transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex gap-6">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-white cursor-pointer transition-colors"
            >
              <Github size={20} strokeWidth={1.5} />
            </a>
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-white cursor-pointer transition-colors"
            >
              <Twitter size={20} strokeWidth={1.5} />
            </a>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-white/5 text-center">
          <p className="text-gray-600 text-sm font-mono">
            © 2025 Quoth Labs. "Wisdom over Guesswork."
          </p>
        </div>
      </div>
    </footer>
  );
}
