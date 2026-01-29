"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

/* -----------------------------------------------------------------------------
   Slide Data
   ----------------------------------------------------------------------------- */
const slides = [
  {
    image: "/flowcharts-images/07-Before-After-Comparison.png",
    title: "From Search to Memory",
    bullets: [
      "Before: Manual search, context bloat, no persistence",
      "After: Automatic injection, subagent handles memory, knowledge grows",
    ],
  },
  {
    image: "/flowcharts-images/01-System-Architecture-Diagram.png",
    title: "The System",
    bullets: [
      "Local .quoth/ folder stores knowledge",
      "6 hooks enforce and capture",
      "quoth-memory subagent (Sonnet)",
    ],
  },
  {
    image: "/flowcharts-images/02-Session-Lifecycle-Diagram.png",
    title: "Every Session, Captured",
    bullets: [
      "Context injected at start",
      "Actions logged as you work",
      "Learnings promoted at end",
    ],
  },
  {
    image: "/flowcharts-images/03-Knowledge-Flow-Diagram.png",
    title: "Knowledge Promotion",
    bullets: [
      "Session captures decisions & patterns",
      "You approve what persists",
      "Local → Remote sync optional",
    ],
  },
  {
    image: "/flowcharts-images/04-Strictness-Modes-Diagram.png",
    title: "Your Rules",
    bullets: [
      "Blocking: Enforce gates strictly",
      "Reminder: Gentle nudges",
      "Off: Full manual control",
    ],
  },
  {
    image: "/flowcharts-images/06-Getting-Started-Guide.png",
    title: "3 Minutes to Memory",
    bullets: [
      "Install plugin",
      "Run /quoth-init",
      "Start coding",
    ],
  },
];

/* -----------------------------------------------------------------------------
   FlowchartShowcase Component
   ----------------------------------------------------------------------------- */
export function FlowchartShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sectionRefs.current.forEach((ref, index) => {
      if (!ref) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveIndex(index);
          }
        },
        { threshold: 0.5, rootMargin: "-20% 0px -20% 0px" }
      );

      observer.observe(ref);
      observers.push(observer);
    });

    return () => {
      observers.forEach((observer) => observer.disconnect());
    };
  }, []);

  return (
    <section className="relative bg-gradient-to-b from-obsidian via-charcoal/30 to-obsidian">
      {/* Section Header */}
      <div className="text-center py-16 sm:py-20 px-4">
        <h2
          className="animate-fade-in-scale font-serif text-2xl sm:text-3xl md:text-4xl text-white mb-4"
          style={{ fontFamily: "var(--font-cinzel), serif" }}
        >
          How It Works
        </h2>
        <p className="animate-fade-in-scale text-gray-500 font-light text-sm sm:text-base">
          Scroll to explore the architecture
        </p>
      </div>

      {/* Desktop: Side by side with sticky image */}
      <div className="hidden md:block relative">
        <div className="max-w-7xl mx-auto flex">
          {/* Sticky Image Container - full edge-to-edge */}
          <div className="w-3/5 relative">
            <div className="sticky top-20 h-[80vh] flex items-center justify-center pointer-events-none">
              <div className="relative w-full h-full">
                {slides.map((slide, i) => (
                  <div
                    key={i}
                    className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ease-out
                      ${activeIndex === i
                        ? "opacity-100 scale-100"
                        : "opacity-0 scale-95"
                      }`}
                  >
                    <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl shadow-violet-spectral/20 border border-violet-spectral/20">
                      <Image
                        src={slide.image}
                        alt={slide.title}
                        fill
                        className="object-contain bg-charcoal/50"
                        sizes="(max-width: 768px) 100vw, 60vw"
                        priority={i === 0}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable Text - Compact cards, right side */}
          <div className="w-2/5 px-6">
            {slides.map((slide, i) => (
              <div
                key={i}
                ref={(el) => {
                  sectionRefs.current[i] = el;
                }}
                className="min-h-screen flex items-center py-16"
              >
                <div
                  className={`w-full p-6 rounded-xl border transition-all duration-500
                    ${activeIndex === i
                      ? "bg-charcoal/80 border-violet-spectral/30 shadow-lg shadow-violet-spectral/10"
                      : "bg-charcoal/[0.32] border-white/5"
                    }`}
                >
                  {/* Slide number */}
                  <div className="flex items-center gap-2.5 mb-3">
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors duration-300
                        ${activeIndex === i
                          ? "bg-violet-spectral text-white"
                          : "bg-white/10 text-gray-500"
                        }`}
                    >
                      {i + 1}
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-r from-violet-spectral/50 to-transparent" />
                  </div>

                  {/* Title */}
                  <h3
                    className="text-lg sm:text-xl text-white font-serif mb-4"
                    style={{ fontFamily: "var(--font-cinzel), serif" }}
                  >
                    {slide.title}
                  </h3>

                  {/* Bullets */}
                  <ul className="space-y-3">
                    {slide.bullets.map((bullet, j) => (
                      <li
                        key={j}
                        className="text-gray-400 text-sm flex items-start gap-2.5 leading-relaxed"
                      >
                        <span className="text-violet-spectral mt-1 text-xs">&#9670;</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: Stacked layout */}
      <div className="md:hidden space-y-12 px-4 pb-16">
        {slides.map((slide, i) => (
          <div key={i} className="space-y-4">
            {/* Image */}
            <div className="relative aspect-[16/10] rounded-xl overflow-hidden border border-violet-spectral/20 shadow-lg shadow-violet-spectral/10">
              <Image
                src={slide.image}
                alt={slide.title}
                fill
                className="object-contain bg-charcoal/50"
                sizes="100vw"
              />
            </div>

            {/* Content */}
            <div className="p-6 rounded-xl bg-charcoal/60 border border-white/10">
              {/* Slide number */}
              <div className="flex items-center gap-3 mb-4">
                <span className="w-7 h-7 rounded-full bg-violet-spectral text-white flex items-center justify-center text-sm font-medium">
                  {i + 1}
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-violet-spectral/50 to-transparent" />
              </div>

              {/* Title */}
              <h3
                className="text-lg text-white font-serif mb-4"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                {slide.title}
              </h3>

              {/* Bullets */}
              <ul className="space-y-3">
                {slide.bullets.map((bullet, j) => (
                  <li
                    key={j}
                    className="text-gray-400 text-sm flex items-start gap-2 leading-relaxed"
                  >
                    <span className="text-violet-spectral mt-1 text-xs">&#9670;</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {/* Progress indicators (desktop only) */}
      <div className="hidden md:flex fixed right-8 top-1/2 -translate-y-1/2 flex-col gap-2 z-50">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              sectionRefs.current[i]?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }}
            className={`w-2 h-2 rounded-full transition-all duration-300
              ${activeIndex === i
                ? "bg-violet-spectral scale-150"
                : "bg-white/20 hover:bg-white/40"
              }`}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
