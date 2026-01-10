"use client";

import { BookOpen, Scale, RefreshCw, Eye } from "lucide-react";
import { Navbar, Footer, PageHeader, GlassCard } from "@/components/quoth";
import { Separator } from "@/components/ui/separator";

const principles = [
  {
    icon: BookOpen,
    title: "Documentation as Law",
    description:
      "In the Quoth paradigm, documentation isn't a suggestion—it's legislation. Every pattern file in your knowledge base becomes a binding contract that AI agents must respect and enforce.",
    quote:
      "If it's not documented, it doesn't exist. If it is documented, it must be obeyed.",
  },
  {
    icon: Scale,
    title: "No More Hallucinations",
    description:
      "AI models hallucinate when they lack authoritative sources. Quoth provides that authority—a curated, versioned knowledge base that serves as the single source of truth for your codebase.",
    quote:
      "We don't guess. We don't assume. We read, contrast, and verify.",
  },
  {
    icon: RefreshCw,
    title: "The Read-Contrast-Update Loop",
    description:
      "Documentation dies the moment it's written—unless there's a system to keep it alive. Quoth enforces a continuous loop: read the docs, contrast with reality, propose updates when drift is detected.",
    quote:
      "Stale documentation is worse than no documentation. We keep it breathing.",
  },
  {
    icon: Eye,
    title: "Transparent Reasoning",
    description:
      "Every suggestion Quoth makes comes with a citation. You'll always know which document, which pattern, which rule led to a specific recommendation. No black boxes.",
    quote:
      "Show your work. Always cite your sources. Let humans verify.",
  },
];

export default function ManifestoPage() {
  return (
    <div className="min-h-screen animate-page-fade-in">
      <Navbar />

      <PageHeader
        badge="Philosophy"
        title="The Quoth Manifesto"
        subtitle="The principles that guide our approach to AI-assisted development and documentation integrity."
      />

      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="glass-panel p-8 rounded-lg mb-16">
            <p className="text-lg text-gray-300 leading-relaxed font-light italic text-center">
              "Quoth the Raven, 'Nevermore' shall your AI hallucinate, guess, or
              contradict your documented architecture. We bring wisdom where
              there was guesswork, certainty where there was chaos."
            </p>
          </div>

          <div className="space-y-8">
            {principles.map((principle, index) => (
              <div key={index} className="animate-fade-in" style={{ animationDelay: `${index * 0.1}s` }}>
                <GlassCard
                  icon={principle.icon}
                  title={principle.title}
                  description={principle.description}
                  hover={false}
                >
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <p className="text-violet-ghost text-sm italic">
                      "{principle.quote}"
                    </p>
                  </div>
                </GlassCard>
                {index < principles.length - 1 && (
                  <Separator className="my-8 bg-white/5" />
                )}
              </div>
            ))}
          </div>

          <div className="mt-16 text-center">
            <h2
              className="font-serif text-2xl text-white mb-4"
              style={{ fontFamily: "var(--font-cinzel), serif" }}
            >
              The Bottom Line
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto leading-relaxed">
              Quoth exists because we believe AI should enhance human expertise,
              not replace it. By providing AI agents with authoritative
              documentation and enforcing compliance, we create a symbiotic
              relationship where humans define the rules and AI follows them
              precisely.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
