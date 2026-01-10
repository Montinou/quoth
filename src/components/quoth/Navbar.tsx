"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavLink {
  href: string;
  label: string;
}

interface NavbarProps {
  className?: string;
  links?: NavLink[];
  showAuth?: boolean;
}

const defaultLinks: NavLink[] = [
  { href: "/manifesto", label: "Manifesto" },
  { href: "/protocol", label: "Protocol" },
  { href: "/pricing", label: "Pricing" },
];

export function Navbar({
  className,
  links = defaultLinks,
  showAuth = true,
}: NavbarProps) {
  return (
    <nav
      className={cn(
        "fixed top-0 w-full z-50 glass-panel border-b-0 border-b-white/5",
        className
      )}
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/">
          <Logo />
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
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

        {showAuth && (
          <div className="flex items-center gap-4">
            <button className="hidden md:block text-sm text-gray-400 hover:text-white transition-colors">
              Login
            </button>
            <Button variant="glass" size="lg" className="group">
              <span>Install Auditor</span>
              <span className="group-hover:translate-x-1 transition-transform">
                →
              </span>
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}
