"use client";

import { Terminal, Key, Zap, CheckCircle, Settings } from "lucide-react";
import { Navbar, Footer, PageHeader, GlassCard } from "@/components/quoth";
import {
  CodeBlock,
  CodeLine,
  CodeKeyword,
} from "@/components/quoth/CodeBlock";
import { Badge } from "@/components/ui/badge";

const cliCommands = [
  {
    command: "quoth login",
    description: "Authenticate and configure Claude Code",
  },
  {
    command: "quoth logout",
    description: "Remove authentication (keeps public access)",
  },
  {
    command: "quoth status",
    description: "Show current configuration",
  },
  {
    command: "quoth help",
    description: "Show help message",
  },
];

const features = [
  {
    name: "quoth_search_index",
    description: "Semantic search across documentation",
    access: "public",
  },
  {
    name: "quoth_read_doc",
    description: "Read full document content",
    access: "public",
  },
  {
    name: "quoth_propose_update",
    description: "Propose documentation updates",
    access: "authenticated",
  },
  {
    name: "quoth_architect prompt",
    description: "Code generation with pattern enforcement",
    access: "public",
  },
  {
    name: "quoth_auditor prompt",
    description: "Code review with violation detection",
    access: "public",
  },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen animate-page-fade-in">
      <Navbar />

      <PageHeader
        badge="Getting Started"
        title="Deploy Quoth Server"
        subtitle="Set up Quoth in your AI development workflow in under 2 minutes."
      />

      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto space-y-20">
          {/* Step 1: Quick Start */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <Zap size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                Quick Start
              </h2>
              <Badge variant="outline" className="border-green-500/50 text-green-400">
                OAuth Auto-Login
              </Badge>
            </div>

            <p className="text-gray-400 mb-6">
              Add Quoth to Claude Code. When you authenticate, your browser opens for login and connects automatically.
            </p>

            <CodeBlock filename="terminal">
              <CodeLine>
                <span className="text-gray-500"># Add to Claude Code with OAuth</span>
              </CodeLine>
              <CodeLine>
                <CodeKeyword>claude</CodeKeyword> mcp add --transport http quoth https://quoth.ai-innovation.site/api/mcp
              </CodeLine>
              <br />
              <CodeLine>
                <span className="text-gray-500"># Then run /mcp → select quoth → Authenticate</span>
              </CodeLine>
              <CodeLine>
                <span className="text-gray-500"># Browser opens → Login → Done!</span>
              </CodeLine>
            </CodeBlock>

            <p className="text-gray-500 text-sm mt-4">
              This gives full access to all tools and your private knowledge bases.
            </p>
          </div>

          {/* Step 2: Public Demo */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <Key size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                Public Demo (No Auth)
              </h2>
            </div>

            <p className="text-gray-400 mb-6">
              Try Quoth without authentication using the public read-only endpoint.
            </p>

            <CodeBlock filename="terminal">
              <CodeLine>
                <span className="text-gray-500"># Add public demo endpoint</span>
              </CodeLine>
              <CodeLine>
                <CodeKeyword>claude</CodeKeyword> mcp add --transport http quoth-public https://quoth.ai-innovation.site/api/mcp/public
              </CodeLine>
            </CodeBlock>

            <div className="mt-6 glass-panel p-4 rounded-lg border border-violet-spectral/20">
              <p className="text-violet-ghost text-sm">
                No login required. Provides read-only access to the public knowledge base
                for testing and exploration.
              </p>
            </div>
          </div>

          {/* CLI Commands Reference */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <Terminal size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                CLI Commands
              </h2>
            </div>

            <div className="space-y-3">
              {cliCommands.map((cmd) => (
                <div
                  key={cmd.command}
                  className="flex items-center gap-4 glass-panel p-4 rounded-lg"
                >
                  <code className="text-violet-spectral font-mono bg-violet-spectral/10 px-3 py-1 rounded">
                    {cmd.command}
                  </code>
                  <span className="text-gray-400 text-sm">{cmd.description}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Manual Configuration */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <Settings size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                Manual Configuration
              </h2>
            </div>

            <p className="text-gray-400 mb-6">
              If you prefer manual setup, generate a token from the dashboard and configure directly:
            </p>

            <CodeBlock filename="claude_desktop_config.json">
              <div>
                <CodeKeyword type="string">{`{`}</CodeKeyword>
              </div>
              <CodeLine indent={1}>
                <CodeKeyword type="string">"mcpServers"</CodeKeyword>: {`{`}
              </CodeLine>
              <CodeLine indent={2}>
                <CodeKeyword type="string">"quoth"</CodeKeyword>: {`{`}
              </CodeLine>
              <CodeLine indent={3}>
                <CodeKeyword type="string">"url"</CodeKeyword>:{" "}
                <CodeKeyword type="string">"https://quoth.ai-innovation.site/api/mcp"</CodeKeyword>,
              </CodeLine>
              <CodeLine indent={3}>
                <CodeKeyword type="string">"headers"</CodeKeyword>: {`{`}
              </CodeLine>
              <CodeLine indent={4}>
                <CodeKeyword type="string">"Authorization"</CodeKeyword>:{" "}
                <CodeKeyword type="string">"Bearer YOUR_TOKEN"</CodeKeyword>
              </CodeLine>
              <CodeLine indent={3}>{`}`}</CodeLine>
              <CodeLine indent={2}>{`}`}</CodeLine>
              <CodeLine indent={1}>{`}`}</CodeLine>
              <div>
                <CodeKeyword type="string">{`}`}</CodeKeyword>
              </div>
            </CodeBlock>
          </div>

          {/* What You Get */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <CheckCircle size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                What You Get
              </h2>
            </div>

            <div className="space-y-3">
              {features.map((feature) => (
                <div
                  key={feature.name}
                  className="flex items-center justify-between glass-panel p-4 rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <code className="text-violet-spectral font-mono text-sm">
                      {feature.name}
                    </code>
                    <span className="text-gray-400 text-sm">{feature.description}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      feature.access === "public"
                        ? "border-green-500/50 text-green-400"
                        : "border-violet-spectral/50 text-violet-ghost"
                    }
                  >
                    {feature.access}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
