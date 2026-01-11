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
                Public Demo
              </Badge>
            </div>

            <p className="text-gray-400 mb-6">
              Get started immediately with the public demo. No authentication required.
            </p>

            <CodeBlock filename="terminal">
              <CodeLine>
                <span className="text-gray-500"># Install the CLI</span>
              </CodeLine>
              <CodeLine>
                <CodeKeyword>npm</CodeKeyword> install -g @quoth/mcp
              </CodeLine>
              <br />
              <CodeLine>
                <span className="text-gray-500"># Add to Claude Code</span>
              </CodeLine>
              <CodeLine>
                <CodeKeyword>claude</CodeKeyword> mcp add quoth
              </CodeLine>
            </CodeBlock>

            <p className="text-gray-500 text-sm mt-4">
              This gives immediate access to search and read tools using the public knowledge base.
            </p>
          </div>

          {/* Step 2: Authentication */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <Key size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                Authenticate for Private Projects
              </h2>
            </div>

            <p className="text-gray-400 mb-6">
              Unlock full features including private knowledge bases and documentation proposals.
            </p>

            <CodeBlock filename="terminal">
              <CodeLine>
                <span className="text-gray-500"># Run login command</span>
              </CodeLine>
              <CodeLine>
                <CodeKeyword>quoth</CodeKeyword> login
              </CodeLine>
              <br />
              <CodeLine>
                <span className="text-gray-500"># Opens browser for authentication</span>
              </CodeLine>
              <CodeLine>
                <span className="text-gray-500"># Copy the token and paste in terminal</span>
              </CodeLine>
            </CodeBlock>

            <div className="mt-6 glass-panel p-4 rounded-lg border border-violet-spectral/20">
              <p className="text-violet-ghost text-sm">
                After authentication, you get access to your private knowledge bases,
                the <code className="bg-violet-spectral/20 px-1.5 py-0.5 rounded">quoth_propose_update</code> tool,
                and team collaboration features.
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
