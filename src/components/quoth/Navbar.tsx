"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

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
  { href: "/guide", label: "Guide" },
  { href: "/pricing", label: "Pricing" },
];

export function Navbar({
  className,
  links = defaultLinks,
  showAuth = true,
}: NavbarProps) {
  const { user, profile, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

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
            {user && profile ? (
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 text-sm hover:text-violet-ghost transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-violet-spectral/20 flex items-center justify-center border border-violet-spectral/30">
                    <span className="text-violet-spectral font-medium">
                      {profile.username?.[0]?.toUpperCase()}
                    </span>
                  </div>
                  <span className="hidden md:block">{profile.username}</span>
                  <svg
                    className={cn(
                      "w-4 h-4 transition-transform",
                      dropdownOpen && "rotate-180"
                    )}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {dropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setDropdownOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-48 glass-panel rounded-lg shadow-lg z-50">
                      <Link
                        href="/dashboard"
                        className="block px-4 py-2 hover:bg-white/5 transition-colors rounded-t-lg"
                        onClick={() => setDropdownOpen(false)}
                      >
                        Dashboard
                      </Link>
                      <Link
                        href="/proposals"
                        className="block px-4 py-2 hover:bg-white/5 transition-colors"
                        onClick={() => setDropdownOpen(false)}
                      >
                        Proposals
                      </Link>
                      <hr className="border-graphite/50 my-1" />
                      <button
                        onClick={() => {
                          setDropdownOpen(false);
                          signOut();
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-white/5 transition-colors rounded-b-lg text-red-400"
                      >
                        Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="hidden md:block text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Login
                </Link>
                <Button variant="glass" size="lg" className="group" asChild>
                  <Link href="/auth/signup">
                    <span>Get Started</span>
                    <span className="group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </Link>
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
