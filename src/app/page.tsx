/* =============================================================================
   QUOTH LANDING PAGE v2.0 - Elevated Design (SERVER COMPONENT)
   Enhanced animations, atmospheric depth, refined interactions

   Converted to Server Component for ~50KB JS bundle reduction and faster TTI.
   GlassCard now accepts iconName strings instead of icon components.

   Note: Middleware handles redirects for authenticated users to /dashboard
   ============================================================================= */

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Navbar, Footer, GlassCard, FlowchartShowcase } from "@/components/quoth";
import { Button } from "@/components/ui/button";
import { CodeDemo } from "@/components/quoth/CodeDemo";

/* -----------------------------------------------------------------------------
   Background Effects Component
   ----------------------------------------------------------------------------- */
const BackgroundEffects = () => (
  <div className="fixed inset-0 pointer-events-none overflow-hidden">
    {/* Primary glow orb */}
    <div
      className="orb w-[600px] h-[600px] bg-violet-spectral/20 top-[-200px] left-1/2 -translate-x-1/2"
      style={{ animationDelay: "0s" }}
    />

    {/* Secondary orbs */}
    <div
      className="orb w-[400px] h-[400px] bg-violet-glow/10 top-[40%] left-[-100px]"
      style={{ animationDelay: "-5s" }}
    />
    <div
      className="orb w-[300px] h-[300px] bg-violet-spectral/10 bottom-[20%] right-[-50px]"
      style={{ animationDelay: "-10s" }}
    />

    {/* Subtle grid overlay */}
    <div className="absolute inset-0 grid-bg" />

    {/* Noise texture */}
    <div className="noise-overlay" />
  </div>
);

/* -----------------------------------------------------------------------------
   Hero Section
   ----------------------------------------------------------------------------- */
const Hero = () => (
  <section className="relative min-h-screen flex items-center pt-20 pb-16 px-4 sm:px-6 overflow-hidden">
    {/* Localized glow effect */}
    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-violet-spectral/8 rounded-full blur-[120px] pointer-events-none" />

    <div className="max-w-4xl mx-auto text-center relative z-10">
      {/* Badge */}
      <div className="animate-hero-badge inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs text-violet-ghost tracking-widest uppercase mb-8 backdrop-blur-sm">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-spectral opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-spectral" />
        </span>
        Model Context Protocol Server
      </div>

      {/* Main Title */}
      <h1
        className="animate-hero-title font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-medium text-white leading-[1.1] mb-8"
        style={{
          fontFamily: "var(--font-cinzel), serif",
          animationDelay: "0.1s",
        }}
      >
        Nevermore Forget.
        <br />
        <span className="text-gradient-animate font-serif" style={{ fontFamily: "var(--font-cinzel), serif" }}>
          Quoth
        </span>{" "}
        <span className="text-white">The Memories.</span>
      </h1>

      {/* Subtitle */}
      <p
        className="animate-fade-in-scale font-light text-base sm:text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-12 leading-relaxed"
        style={{ animationDelay: "0.3s" }}
      >
        Knowledge that outlives the session.
        <span className="block mt-2 text-gray-500">
          Wisdom that grows with every conversation.
        </span>
      </p>

      {/* CTA Buttons */}
      <div
        className="animate-fade-in-scale flex flex-col sm:flex-row items-center justify-center gap-4"
        style={{ animationDelay: "0.4s" }}
      >
        <Button
          variant="glass"
          size="lg"
          className="bg-violet-spectral/15 border-violet-spectral/50 hover:bg-violet-spectral/25 w-full sm:w-auto group btn-shine px-8 py-6 text-base"
          asChild
        >
          <Link href="/guide">
            <Sparkles size={18} strokeWidth={1.5} className="mr-2 opacity-70" />
            Deploy Quoth Server
            <span className="group-hover:translate-x-1 transition-transform duration-300 ml-2">
              →
            </span>
          </Link>
        </Button>
        <Link
          href="/protocol"
          className="px-6 py-3 text-gray-400 hover:text-white transition-all duration-300 text-sm tracking-wide uppercase relative group"
        >
          <span className="relative z-10">Read the Protocol</span>
          <span className="absolute bottom-2 left-0 w-0 h-px bg-gradient-to-r from-transparent via-violet-spectral to-transparent group-hover:w-full transition-all duration-500" />
        </Link>
      </div>

      {/* Code Demo */}
      <div
        className="animate-fade-in-scale mt-16 sm:mt-20"
        style={{ animationDelay: "0.6s" }}
      >
        <CodeDemo />
      </div>
    </div>
  </section>
);

/* -----------------------------------------------------------------------------
   Genesis Demo Section
   ----------------------------------------------------------------------------- */
const GenesisDemo = () => {
  return (
    <section className="relative py-24 px-4 sm:px-6 overflow-hidden">
      {/* Section background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-obsidian via-charcoal/50 to-obsidian" />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-12 sm:mb-16">
          <h2
            className="animate-fade-in-scale font-serif text-2xl sm:text-3xl md:text-4xl text-white mb-4"
            style={{ fontFamily: "var(--font-cinzel), serif" }}
          >
            Memory That Learns With You
          </h2>
          <p
            className="animate-fade-in-scale text-gray-400 font-light text-sm sm:text-base max-w-2xl mx-auto"
            style={{ animationDelay: "0.1s" }}
          >
            Initialize AI Memory in seconds. Every session captures knowledge.
            End-of-session prompts let you promote learnings to persistent storage.
          </p>
        </div>

        {/* Terminal Mockup */}
        <div
          className="animate-fade-in-scale max-w-3xl mx-auto"
          style={{ animationDelay: "0.2s" }}
        >
          <div className="relative rounded-xl overflow-hidden border border-violet-spectral/20 bg-charcoal shadow-2xl shadow-violet-glow/10 font-mono text-sm code-window">
            {/* Scanline effect */}
            <div className="scanline opacity-30" />

            {/* Terminal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-obsidian/80">
              {/* Traffic lights */}
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80 border border-red-500/40" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80 border border-yellow-500/40" />
                <div className="w-3 h-3 rounded-full bg-green-500/80 border border-green-500/40" />
              </div>

              {/* Terminal title */}
              <div className="text-xs text-gray-500 font-medium">
                Terminal
              </div>

              {/* Spacer */}
              <div className="w-[52px]" />
            </div>

            {/* Terminal Body */}
            <div className="p-4 sm:p-6 text-gray-400 leading-relaxed overflow-x-auto text-left space-y-4">
              {/* Step 1: Add Marketplace */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">$</span>
                  <span className="text-white">/plugin install quoth@quoth-marketplace</span>
                </div>
                <div className="pl-4 text-gray-500 text-xs sm:text-sm">
                  <span className="text-green-400">&#10003;</span> Plugin &apos;quoth&apos; v2.0 installed (MCP + hooks + agents)
                </div>
              </div>

              {/* Step 2: Initialize Memory */}
              <div className="space-y-1 mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">$</span>
                  <span className="text-white">/quoth-init</span>
                </div>
                <div className="pl-4 text-gray-500 text-xs sm:text-sm">
                  <span className="text-green-400">&#10003;</span> Created .quoth/ folder structure
                </div>
              </div>

              {/* Step 3: Session Flow */}
              <div className="space-y-2 mt-6">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">$</span>
                  <span className="text-white">Work session:</span>
                  <span className="text-violet-ghost">&quot;Create auth service tests&quot;</span>
                </div>

                {/* Session Flow Animation */}
                <div className="pl-4 space-y-2 border-l-2 border-violet-spectral/30 ml-1">
                  {/* Context injection */}
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-violet-spectral animate-pulse-slow">&#9670;</span>
                    <span className="text-gray-400">Context injected from .quoth/*.md</span>
                    <span className="text-green-400 ml-auto">~500 tokens</span>
                  </div>

                  {/* Pattern search */}
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-violet-spectral animate-pulse-slow">&#9670;</span>
                    <span className="text-gray-400">Searching patterns.md for test conventions</span>
                    <span className="text-green-400 ml-auto">found</span>
                  </div>

                  {/* Work logged */}
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-violet-spectral animate-pulse-slow">&#9670;</span>
                    <span className="text-gray-400">Actions logged to .quoth/sessions/abc123/</span>
                    <span className="text-green-400 ml-auto">3 entries</span>
                  </div>

                  {/* Session end */}
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-violet-spectral animate-pulse-slow">&#9670;</span>
                    <span className="text-gray-400">Session end: reviewing learnings...</span>
                    <span className="text-green-400 ml-auto">2 patterns</span>
                  </div>
                </div>

                {/* Completion */}
                <div className="mt-4 p-3 bg-gradient-to-r from-violet-500/10 to-violet-500/5 border-l-2 border-violet-spectral rounded-r-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-violet-ghost text-lg">&#9733;</span>
                    <span className="text-white font-medium">Learnings promoted to .quoth/patterns.md</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <div
          className="animate-fade-in-scale text-center mt-10"
          style={{ animationDelay: "0.4s" }}
        >
          <Button
            variant="glass"
            size="lg"
            className="bg-violet-spectral/15 border-violet-spectral/50 hover:bg-violet-spectral/25 group btn-shine px-8 py-6 text-base"
            asChild
          >
            <Link href="/guide">
              <Sparkles size={18} strokeWidth={1.5} className="mr-2 opacity-70" />
              Get Started in 3 Minutes
              <span className="group-hover:translate-x-1 transition-transform duration-300 ml-2">
                &#8594;
              </span>
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
};

/* -----------------------------------------------------------------------------
   Features Section
   ----------------------------------------------------------------------------- */
const Features = () => (
  <section className="relative py-24 sm:py-32 px-4 sm:px-6">
    {/* Section background */}
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-charcoal/30 to-transparent" />

    <div className="max-w-7xl mx-auto relative z-10">
      {/* Section Header */}
      <div className="text-center mb-16 sm:mb-20">
        <h2
          className="animate-fade-in-scale font-serif text-2xl sm:text-3xl md:text-4xl text-white mb-4"
          style={{ fontFamily: "var(--font-cinzel), serif" }}
        >
          The Memory Architecture
        </h2>
        <p className="animate-fade-in-scale text-gray-500 font-light text-sm sm:text-base" style={{ animationDelay: "0.1s" }}>
          Knowledge as Code. Context as Law.
        </p>
      </div>

      {/* Feature Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        <GlassCard
          iconName="brain"
          title="Local-First Memory"
          description="Knowledge persists in .quoth/ folder across sessions. Decisions, patterns, errors, and learnings survive context compaction."
          className="animate-fade-in-delay-1"
        />
        <GlassCard
          iconName="bot"
          title="quoth-memory Subagent"
          description="A Sonnet-powered memory interface summarizes context (~500 tokens) and answers queries without bloating your main conversation."
          className="animate-fade-in-delay-2"
        />
        <GlassCard
          iconName="git-branch"
          title="Knowledge Promotion"
          description="Session learnings are captured automatically. At session end, choose to promote to local files, remote Quoth, or both."
          className="animate-fade-in-delay-3 sm:col-span-2 lg:col-span-1"
        />
      </div>
    </div>
  </section>
);

/* -----------------------------------------------------------------------------
   Social Proof / Stats Section
   ----------------------------------------------------------------------------- */
const Stats = () => (
  <section className="relative py-20 px-4 sm:px-6 overflow-hidden">
    <div className="max-w-5xl mx-auto relative z-10">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {[
          { value: "v2.0", label: "AI Memory" },
          { value: "~500", label: "Token Context" },
          { value: "6", label: "Hooks Active" },
          { value: "∞", label: "Sessions Captured" },
        ].map((stat, index) => (
          <div
            key={stat.label}
            className="animate-fade-in-scale group"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="text-2xl sm:text-3xl md:text-4xl font-serif text-white mb-2 group-hover:text-violet-ghost transition-colors duration-300" style={{ fontFamily: "var(--font-cinzel), serif" }}>
              {stat.value}
            </div>
            <div className="text-xs sm:text-sm text-gray-500 uppercase tracking-wider">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* -----------------------------------------------------------------------------
   CTA Section
   ----------------------------------------------------------------------------- */
const CallToAction = () => (
  <section className="relative py-24 sm:py-32 px-4 sm:px-6 overflow-hidden">
    {/* Background glow */}
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-violet-spectral/10 rounded-full blur-[100px] pointer-events-none" />

    <div className="max-w-3xl mx-auto text-center relative z-10">
      <h2
        className="animate-fade-in-scale font-serif text-2xl sm:text-3xl md:text-4xl text-white mb-6"
        style={{ fontFamily: "var(--font-cinzel), serif" }}
      >
        Ready to Never Forget?
      </h2>
      <p className="animate-fade-in-scale text-gray-400 mb-10 text-sm sm:text-base" style={{ animationDelay: "0.1s" }}>
        Knowledge that persists. Patterns that compound.
      </p>
      <div
        className="animate-fade-in-scale flex flex-col sm:flex-row items-center justify-center gap-4"
        style={{ animationDelay: "0.2s" }}
      >
        <Button
          variant="glass"
          size="lg"
          className="bg-violet-spectral/15 border-violet-spectral/50 hover:bg-violet-spectral/25 w-full sm:w-auto group btn-shine"
          asChild
        >
          <Link href="/auth/signup">
            Start for Free
            <span className="group-hover:translate-x-1 transition-transform duration-300 ml-2">
              →
            </span>
          </Link>
        </Button>
        <Link
          href="/pricing"
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          View Pricing
        </Link>
      </div>
    </div>
  </section>
);

/* -----------------------------------------------------------------------------
   Main Page Component
   ----------------------------------------------------------------------------- */
export default function Home() {
  return (
    <div className="min-h-screen animate-page-fade-in bg-obsidian">
      <BackgroundEffects />
      <Navbar />
      <main>
        <Hero />
        <FlowchartShowcase />
        <GenesisDemo />
        <Features />
        <Stats />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}
