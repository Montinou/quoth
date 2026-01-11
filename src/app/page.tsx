/* =============================================================================
   QUOTH LANDING PAGE - APPROVED DESIGN
   Using shared Quoth components
   ============================================================================= */
"use client";

import { Database, ShieldAlert, History } from "lucide-react";
import Link from "next/link";
import { Navbar, Footer, GlassCard } from "@/components/quoth";
import { Button } from "@/components/ui/button";
import {
  CodeBlock,
  CodeLine,
  CodeKeyword,
  CodeSuggestion,
} from "@/components/quoth/CodeBlock";

const CodeDemo = () => {
  return (
    <CodeBlock
      filename="UserService.test.ts"
      status="auditing"
      className="max-w-2xl mx-auto mt-16"
    >
      <div className="mb-4 text-gray-500">
        // <span className="text-violet-spectral">Quoth Analysis:</span> 1
        Violation Detected
      </div>

      <div>
        <CodeKeyword>import</CodeKeyword> {"{"} describe, it, expect {"}"}{" "}
        <CodeKeyword>from</CodeKeyword>{" "}
        <CodeKeyword type="string">'vitest'</CodeKeyword>;
      </div>
      <div>
        <CodeKeyword>import</CodeKeyword> {"{"} UserService {"}"}{" "}
        <CodeKeyword>from</CodeKeyword>{" "}
        <CodeKeyword type="string">'./UserService'</CodeKeyword>;
      </div>
      <br />

      <div className="opacity-50">
        describe(<CodeKeyword type="string">'UserService'</CodeKeyword>, () ={">"}{" "}
        {"{"}
      </div>
      <CodeLine indent={1} className="opacity-50">
        it(<CodeKeyword type="string">'should fetch user'</CodeKeyword>,{" "}
        <CodeKeyword>async</CodeKeyword> () ={">"} {"{"}
      </CodeLine>

      <CodeLine indent={2} highlight>
        <CodeKeyword>const</CodeKeyword> mock = jest.fn();{" "}
        <span className="text-xs uppercase tracking-widest text-violet-ghost ml-4 font-sans border border-violet-spectral/50 px-2 py-0.5 rounded bg-violet-spectral/20">
          Violation
        </span>
      </CodeLine>

      <CodeLine indent={2} className="opacity-50">
        ...
      </CodeLine>

      <CodeSuggestion source="According to 'patterns/backend-unit-vitest.md', Jest globals are forbidden. Use Vitest native utilities.">
        <CodeKeyword>const</CodeKeyword> mock = vi.fn();
      </CodeSuggestion>
    </CodeBlock>
  );
};

const Hero = () => (
  <section className="relative pt-32 pb-20 px-6 overflow-hidden">
    {/* Background Glow */}
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-violet-spectral/5 rounded-full blur-[100px] -z-10" />

    <div className="max-w-4xl mx-auto text-center relative z-10">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-violet-ghost mb-8 tracking-widest uppercase">
        <span className="w-1 h-1 rounded-full bg-violet-spectral animate-pulse" />
        Model Context Protocol Server
      </div>

      <h1
        className="font-serif text-5xl md:text-7xl font-medium text-white leading-tight mb-8"
        style={{ fontFamily: "var(--font-cinzel), serif" }}
      >
        Nevermore Guess. <br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-spectral to-white">
          Always Know.
        </span>
      </h1>

      <p className="font-light text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
        The AI-driven auditor that aligns your codebase with your documentation.
        Stop hallucinations. Enforce your architecture.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Button
          variant="glass"
          size="lg"
          className="bg-violet-spectral/10 border-violet-spectral/50 hover:bg-violet-spectral/20 w-full sm:w-auto group"
          asChild
        >
          <Link href="/guide">
            Deploy Quoth Server
            <span className="group-hover:translate-x-1 transition-transform ml-2">→</span>
          </Link>
        </Button>
        <Link
          href="/protocol"
          className="px-8 py-4 text-gray-400 hover:text-white transition-colors text-sm tracking-wide uppercase border-b border-transparent hover:border-white w-full sm:w-auto text-center"
        >
          Read the Protocol
        </Link>
      </div>

      <CodeDemo />
    </div>
  </section>
);

const Features = () => (
  <section className="py-24 px-6 bg-charcoal/30">
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <h2
          className="font-serif text-3xl md:text-4xl text-white mb-4"
          style={{ fontFamily: "var(--font-cinzel), serif" }}
        >
          The Digital Scriptorium
        </h2>
        <p className="text-gray-500 font-light">
          Architecture as Code. Documentation as Law.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <GlassCard
          icon={Database}
          title="Semantic Indexing"
          description="Quoth creates a semantic map of your contracts and patterns. It doesn't just read files; it understands architectural intent."
          className="animate-fade-in-delay-1"
        />
        <GlassCard
          icon={ShieldAlert}
          title="Active Auditor"
          description="The 'Auditor Persona' actively monitors PRs. It detects when new code deviates from established patterns like 'backend-unit-vitest'."
          className="animate-fade-in-delay-2"
        />
        <GlassCard
          icon={History}
          title="Drift Prevention"
          description="Documentation usually dies the day it's written. Quoth forces a 'Read-Contrast-Update' loop to keep it alive forever."
          className="animate-fade-in-delay-3"
        />
      </div>
    </div>
  </section>
);

export default function Home() {
  return (
    <div className="min-h-screen animate-page-fade-in">
      <Navbar />
      <Hero />
      <Features />
      <Footer />
    </div>
  );
}
