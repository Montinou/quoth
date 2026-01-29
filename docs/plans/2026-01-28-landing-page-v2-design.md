# Landing Page v2.0 Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update Quoth landing page with new hero messaging, scroll-triggered flowchart showcase, and v2.0 aligned copy.

**Architecture:** Scroll-triggered sticky image + text reveal pattern with Intersection Observer. Client component for interactivity.

**Tech Stack:** Next.js 16, React, Tailwind CSS, Intersection Observer API

---

## Hero Section Updates

### Current
```
Title: "AI Memory. Not Just Search."
Subtitle: "Give Claude persistent memory that learns as you work.
          Local-first storage. Bidirectional knowledge. Session logging."
```

### New
```
Title: "Nevermore Forget."
       "Quoth The Memories."

       - "Quoth" styled with Cinzel font + violet gradient/glow
       - Rest in standard white

Subtitle: "Knowledge that outlives the session.
          Wisdom that grows with every conversation."
```

### Implementation
- Update `<h1>` in Hero component
- Add `<span className="quoth-brand">` around "Quoth" word
- Add CSS class for Cinzel + text-gradient-animate on "Quoth"
- Update `<p>` subtitle text

---

## New Section: FlowchartShowcase

### Placement
After Hero (below CodeDemo), before GenesisDemo

### Behavior
- **Desktop:** Left 50% sticky image, right 50% scrollable text
- **Mobile:** Stacked vertically (image above text for each slide)
- **Transitions:** 0.5s crossfade when text section enters viewport
- **Trigger:** Intersection Observer at 50% threshold

### Content (6 slides)

| # | Image | Title | Bullets |
|---|-------|-------|---------|
| 1 | `07-Before-After-Comparison.png` | **From Search to Memory** | • Before: Manual search, context bloat, no persistence | • After: Automatic injection, subagent handles memory, knowledge grows |
| 2 | `01-System-Architecture-Diagram.png` | **The System** | • Local `.quoth/` folder stores knowledge | • 6 hooks enforce and capture | • quoth-memory subagent (Sonnet) |
| 3 | `02-Session-Lifecycle-Diagram.png` | **Every Session, Captured** | • Context injected at start | • Actions logged as you work | • Learnings promoted at end |
| 4 | `03-Knowledge-Flow-Diagram.png` | **Knowledge Promotion** | • Session captures decisions & patterns | • You approve what persists | • Local → Remote sync optional |
| 5 | `04-Strictness-Modes-Diagram.png` | **Your Rules** | • Blocking: Enforce gates strictly | • Reminder: Gentle nudges | • Off: Full manual control |
| 6 | `06-Getting-Started-Guide.png` | **3 Minutes to Memory** | • Install plugin | • Run `/quoth-init` | • Start coding |

### Component Structure

```tsx
// src/components/quoth/FlowchartShowcase.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

const slides = [
  {
    image: "/flowcharts-images/07-Before-After-Comparison.png",
    title: "From Search to Memory",
    bullets: [
      "Before: Manual search, context bloat, no persistence",
      "After: Automatic injection, subagent handles memory, knowledge grows"
    ]
  },
  // ... other slides
];

export function FlowchartShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observers = sectionRefs.current.map((ref, index) => {
      if (!ref) return null;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveIndex(index);
          }
        },
        { threshold: 0.5 }
      );

      observer.observe(ref);
      return observer;
    });

    return () => {
      observers.forEach((observer) => observer?.disconnect());
    };
  }, []);

  return (
    <section className="relative min-h-[300vh]">
      {/* Section Header */}
      <div className="text-center py-16">
        <h2 className="font-serif text-3xl md:text-4xl text-white">
          How It Works
        </h2>
      </div>

      {/* Desktop: Side by side */}
      <div className="hidden md:block relative">
        {/* Sticky Image */}
        <div className="sticky top-20 left-0 w-1/2 h-[80vh] flex items-center justify-center">
          {slides.map((slide, i) => (
            <Image
              key={i}
              src={slide.image}
              alt={slide.title}
              fill
              className={`object-contain p-8 transition-opacity duration-500
                ${activeIndex === i ? 'opacity-100' : 'opacity-0'}`}
            />
          ))}
        </div>

        {/* Scrollable Text */}
        <div className="absolute top-0 right-0 w-1/2">
          {slides.map((slide, i) => (
            <div
              key={i}
              ref={(el) => (sectionRefs.current[i] = el)}
              className="min-h-screen flex items-center px-8"
            >
              <div className="glass-panel p-8 rounded-xl">
                <h3 className="text-2xl text-white font-serif mb-4">
                  {slide.title}
                </h3>
                <ul className="space-y-3">
                  {slide.bullets.map((bullet, j) => (
                    <li key={j} className="text-gray-400 flex items-start gap-2">
                      <span className="text-violet-spectral mt-1">•</span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: Stacked */}
      <div className="md:hidden space-y-16 px-4">
        {slides.map((slide, i) => (
          <div key={i} className="space-y-4">
            <div className="relative aspect-video">
              <Image
                src={slide.image}
                alt={slide.title}
                fill
                className="object-contain"
              />
            </div>
            <div className="glass-panel p-6 rounded-xl">
              <h3 className="text-xl text-white font-serif mb-3">
                {slide.title}
              </h3>
              <ul className="space-y-2">
                {slide.bullets.map((bullet, j) => (
                  <li key={j} className="text-gray-400 text-sm flex items-start gap-2">
                    <span className="text-violet-spectral mt-0.5">•</span>
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

---

## Features Section Update

### Current Header
```
"The Digital Scriptorium"
"Architecture as Code. Documentation as Law."
```

### New Header
```
"The Memory Architecture"
"Knowledge as Code. Context as Law."
```

---

## CTA Section Update

### Current
```
Title: "Ready to give Claude real memory?"
Subtitle: "Transform from session amnesia to persistent knowledge.
          Start capturing learnings today."
```

### New
```
Title: "Ready to Never Forget?"
Subtitle: "Knowledge that persists. Patterns that compound."
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/page.tsx` | Hero text, Features header, CTA text, import FlowchartShowcase |
| `src/components/quoth/FlowchartShowcase.tsx` | NEW - Client component |
| `src/components/quoth/index.ts` | Export FlowchartShowcase |

---

## Implementation Tasks

1. Create `FlowchartShowcase.tsx` component with scroll-triggered behavior
2. Update Hero section with new headline and subtitle
3. Add CSS class for "Quoth" brand styling (Cinzel + violet gradient)
4. Import and add FlowchartShowcase to page.tsx after Hero
5. Update Features section header
6. Update CTA section copy
7. Test mobile responsiveness
8. Test scroll behavior and transitions
