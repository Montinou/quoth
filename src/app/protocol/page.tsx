"use client";

import { Search, FileText, GitPullRequest, Bot, ShieldCheck } from "lucide-react";
import { Navbar, Footer, PageHeader, GlassCard } from "@/components/quoth";
import {
  CodeBlock,
  CodeLine,
  CodeKeyword,
} from "@/components/quoth/CodeBlock";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

const tools = [
  {
    name: "quoth_search_index",
    description:
      "Searches the knowledge base by topic, returning relevant document IDs.",
    params: [
      { name: "query", type: "string", desc: "The search query" },
      { name: "limit", type: "number", desc: "Max results (default: 5)" },
    ],
    example: `{
  "query": "vitest testing patterns",
  "limit": 3
}`,
    returns: "Array of document IDs with relevance scores",
  },
  {
    name: "quoth_read_doc",
    description:
      "Retrieves the full content of a document from the knowledge base.",
    params: [
      { name: "doc_id", type: "string", desc: "The document identifier" },
    ],
    example: `{
  "doc_id": "patterns/backend-unit-vitest"
}`,
    returns: "Full document content with metadata",
  },
  {
    name: "quoth_propose_update",
    description:
      "Submits a documentation update proposal when drift is detected.",
    params: [
      { name: "doc_id", type: "string", desc: "Target document" },
      { name: "proposed_change", type: "string", desc: "The change content" },
      { name: "evidence", type: "string", desc: "Supporting evidence" },
    ],
    example: `{
  "doc_id": "patterns/backend-unit-vitest",
  "proposed_change": "Add note about vi.spyOn usage",
  "evidence": "Found in UserService.ts:42"
}`,
    returns: "Proposal ID for tracking",
  },
];

const personas = [
  {
    icon: Bot,
    name: "Quoth Architect",
    badge: "Code Generation",
    description:
      "Used during code generation to ensure new code follows documented patterns.",
    behavior: [
      "Searches knowledge base before generating code",
      "Cites specific documents in suggestions",
      "Refuses to generate code that violates patterns",
      "Proposes documentation updates for new patterns",
    ],
  },
  {
    icon: ShieldCheck,
    name: "Quoth Auditor",
    badge: "Code Review",
    description:
      "Used during PR reviews to detect violations and suggest fixes.",
    behavior: [
      "Distinguishes 'New Features' from 'Bad Code'",
      "Flags violations with specific document citations",
      "Suggests compliant alternatives",
      "Tracks drift patterns over time",
    ],
  },
];

export default function ProtocolPage() {
  return (
    <div className="min-h-screen animate-page-fade-in">
      <Navbar />

      <PageHeader
        badge="MCP Server v2.0"
        title="The Protocol"
        subtitle="Technical documentation for integrating Quoth AI Memory into your workflow."
      />

      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Tools Section */}
          <div className="mb-20">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <Search size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                MCP Tools
              </h2>
            </div>

            <Accordion type="single" collapsible className="space-y-4">
              {tools.map((tool) => (
                <AccordionItem
                  key={tool.name}
                  value={tool.name}
                  className="glass-panel border-white/5 rounded-lg px-6"
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-4">
                      <code className="text-violet-spectral font-mono">
                        {tool.name}
                      </code>
                      <span className="text-gray-500 text-sm font-normal">
                        {tool.description}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pt-4 space-y-6">
                      <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-3">
                          Parameters
                        </h4>
                        <div className="space-y-2">
                          {tool.params.map((param) => (
                            <div
                              key={param.name}
                              className="flex items-start gap-3 text-sm"
                            >
                              <code className="text-violet-ghost bg-violet-spectral/10 px-2 py-0.5 rounded">
                                {param.name}
                              </code>
                              <span className="text-gray-600">{param.type}</span>
                              <span className="text-gray-400">{param.desc}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-3">
                          Example
                        </h4>
                        <CodeBlock filename="request.json">
                          <pre className="text-green-400">{tool.example}</pre>
                        </CodeBlock>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-2">
                          Returns
                        </h4>
                        <p className="text-gray-400 text-sm">{tool.returns}</p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* Personas Section */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <Bot size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                AI Personas
              </h2>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {personas.map((persona) => (
                <GlassCard key={persona.name} hover={false} className="relative">
                  <Badge
                    variant="outline"
                    className="absolute top-4 right-4 border-violet-spectral/50 text-violet-ghost"
                  >
                    {persona.badge}
                  </Badge>

                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center">
                      <persona.icon
                        size={20}
                        strokeWidth={1.5}
                        className="text-violet-spectral"
                      />
                    </div>
                    <h3
                      className="font-serif text-xl text-white"
                      style={{ fontFamily: "var(--font-cinzel), serif" }}
                    >
                      {persona.name}
                    </h3>
                  </div>

                  <p className="text-gray-400 text-sm mb-4">
                    {persona.description}
                  </p>

                  <ul className="space-y-2">
                    {persona.behavior.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-violet-spectral mt-1">•</span>
                        <span className="text-gray-300">{item}</span>
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              ))}
            </div>
          </div>

          {/* Integration Example */}
          <div className="mt-20">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded bg-violet-spectral/20 flex items-center justify-center">
                <FileText size={20} strokeWidth={1.5} className="text-violet-spectral" />
              </div>
              <h2
                className="font-serif text-2xl text-white"
                style={{ fontFamily: "var(--font-cinzel), serif" }}
              >
                Quick Start
              </h2>
            </div>

            <CodeBlock filename="mcp.config.json">
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
                <CodeKeyword type="string">"https://quoth.ai-innovation.site/api/mcp"</CodeKeyword>
              </CodeLine>
              <CodeLine indent={2}>{`}`}</CodeLine>
              <CodeLine indent={1}>{`}`}</CodeLine>
              <div>
                <CodeKeyword type="string">{`}`}</CodeKeyword>
              </div>
            </CodeBlock>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
