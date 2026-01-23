/**
 * Public Navbar Component v2.0
 * Refined glassmorphism, mobile responsiveness, sophisticated animations
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

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
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu on resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <nav
        className={cn(
          "fixed top-0 w-full z-50 transition-all duration-500",
          isScrolled
            ? "glass-panel border-b border-white/5 shadow-lg shadow-black/20"
            : "bg-transparent border-b border-transparent",
          className
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 md:h-20 flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="relative z-10 transition-transform duration-300 hover:scale-105"
          >
            <Logo size="md" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {links.map((link, index) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "nav-link px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/5",
                  "animate-fade-in-scale"
                )}
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Desktop Auth */}
          {showAuth && (
            <div className="hidden md:flex items-center gap-3">
              <Link
                href="/auth/login"
                className="text-sm text-gray-400 hover:text-white transition-colors px-4 py-2 rounded-md hover:bg-white/5"
              >
                Login
              </Link>
              <Button
                variant="glass"
                size="default"
                className="group btn-shine"
                asChild
              >
                <Link href="/auth/signup">
                  <span>Get Started</span>
                  <span className="ml-1 group-hover:translate-x-1 transition-transform duration-300">
                    →
                  </span>
                </Link>
              </Button>
            </div>
          )}

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden relative z-10 p-2 text-gray-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
            aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMobileMenuOpen}
          >
            <div className="relative w-6 h-6">
              <Menu
                size={24}
                strokeWidth={1.5}
                className={cn(
                  "absolute inset-0 transition-all duration-300",
                  isMobileMenuOpen
                    ? "opacity-0 rotate-90 scale-50"
                    : "opacity-100 rotate-0 scale-100"
                )}
              />
              <X
                size={24}
                strokeWidth={1.5}
                className={cn(
                  "absolute inset-0 transition-all duration-300",
                  isMobileMenuOpen
                    ? "opacity-100 rotate-0 scale-100"
                    : "opacity-0 -rotate-90 scale-50"
                )}
              />
            </div>
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden transition-all duration-500",
          isMobileMenuOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
      >
        {/* Backdrop */}
        <div
          className={cn(
            "absolute inset-0 bg-obsidian/95 backdrop-blur-xl transition-opacity duration-500",
            isMobileMenuOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setIsMobileMenuOpen(false)}
        />

        {/* Menu Content */}
        <div
          className={cn(
            "absolute inset-x-0 top-16 bottom-0 flex flex-col",
            "transition-all duration-500",
            isMobileMenuOpen
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-4"
          )}
        >
          {/* Navigation Links */}
          <div className="flex-1 flex flex-col justify-center px-6 py-8">
            <div className="space-y-2">
              {links.map((link, index) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "block py-4 px-4 text-2xl font-serif text-gray-300 hover:text-white",
                    "border-b border-white/5 transition-all duration-300",
                    "hover:bg-white/5 hover:pl-6 rounded-lg",
                    isMobileMenuOpen && "animate-slide-down"
                  )}
                  style={{
                    fontFamily: "var(--font-cinzel), serif",
                    animationDelay: isMobileMenuOpen
                      ? `${index * 0.05}s`
                      : "0s",
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Mobile Auth */}
          {showAuth && (
            <div
              className={cn(
                "px-6 py-8 border-t border-white/5 space-y-3",
                isMobileMenuOpen && "animate-slide-down"
              )}
              style={{
                animationDelay: isMobileMenuOpen
                  ? `${links.length * 0.05}s`
                  : "0s",
              }}
            >
              <Button
                variant="glass"
                size="lg"
                className="w-full group btn-shine"
                asChild
              >
                <Link
                  href="/auth/signup"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span>Get Started</span>
                  <span className="ml-1 group-hover:translate-x-1 transition-transform duration-300">
                    →
                  </span>
                </Link>
              </Button>
              <Link
                href="/auth/login"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block w-full text-center py-3 text-gray-400 hover:text-white transition-colors"
              >
                Already have an account? Login
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
