"use client";

import { Navbar, Footer, PageHeader, PricingCard } from "@/components/quoth";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const tiers = [
  {
    name: "Free",
    description: "For individual developers and small projects",
    price: "$0",
    features: [
      { text: "Up to 50 documents in knowledge base", included: true },
      { text: "3 MCP tool calls per minute", included: true },
      { text: "Community support", included: true },
      { text: "Basic audit logging", included: true },
      { text: "Custom personas", included: false },
      { text: "Team collaboration", included: false },
      { text: "Priority support", included: false },
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Pro",
    description: "For growing teams and serious projects",
    price: "$29",
    features: [
      { text: "Unlimited documents", included: true },
      { text: "100 MCP tool calls per minute", included: true },
      { text: "Email support", included: true },
      { text: "Full audit logging with exports", included: true },
      { text: "Custom personas (up to 5)", included: true },
      { text: "Team collaboration (up to 10)", included: true },
      { text: "Priority support", included: false },
    ],
    cta: "Start Pro Trial",
    highlighted: true,
    badge: "Popular",
  },
  {
    name: "Enterprise",
    description: "For organizations requiring full control",
    price: "Custom",
    features: [
      { text: "Unlimited everything", included: true },
      { text: "Unlimited MCP tool calls", included: true },
      { text: "Dedicated support engineer", included: true },
      { text: "Custom integrations", included: true },
      { text: "Unlimited custom personas", included: true },
      { text: "Unlimited team members", included: true },
      { text: "SLA guarantee", included: true },
    ],
    cta: "Contact Sales",
    highlighted: false,
  },
];

const faqs = [
  {
    question: "What is a knowledge base document?",
    answer:
      "A knowledge base document is any markdown file with YAML frontmatter that defines patterns, contracts, or architecture documentation. Quoth indexes these files and makes them searchable for AI agents.",
  },
  {
    question: "How are MCP tool calls counted?",
    answer:
      "Each invocation of quoth_search_index, quoth_read_doc, or quoth_propose_update counts as one tool call. Calls are counted per minute with a rolling window.",
  },
  {
    question: "Can I self-host Quoth?",
    answer:
      "Yes! Quoth is open source and can be self-hosted. The pricing tiers apply to our hosted service at quoth.ai-innovation.site. Self-hosting is free but requires your own infrastructure.",
  },
  {
    question: "What's included in custom personas?",
    answer:
      "Custom personas allow you to define specialized AI behaviors beyond the default Architect and Auditor. You can create personas for specific domains like 'Security Auditor' or 'Performance Reviewer' with custom rules.",
  },
  {
    question: "How does team collaboration work?",
    answer:
      "Team collaboration allows multiple developers to share a knowledge base, review proposed updates, and manage AI personas together. Changes to documentation are tracked with full audit history.",
  },
  {
    question: "Is there a free trial for Pro?",
    answer:
      "Yes! Pro tier includes a 14-day free trial with full access to all features. No credit card required to start.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen animate-page-fade-in">
      <Navbar />

      <PageHeader
        badge="Plans"
        title="Pricing"
        subtitle="Choose the plan that fits your documentation enforcement needs."
      />

      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-8 mb-20">
            {tiers.map((tier) => (
              <PricingCard
                key={tier.name}
                {...tier}
                className="animate-fade-in"
              />
            ))}
          </div>

          {/* FAQ Section */}
          <div className="max-w-3xl mx-auto">
            <h2
              className="font-serif text-2xl text-white text-center mb-8"
              style={{ fontFamily: "var(--font-cinzel), serif" }}
            >
              Frequently Asked Questions
            </h2>

            <Accordion type="single" collapsible className="space-y-4">
              {faqs.map((faq, index) => (
                <AccordionItem
                  key={index}
                  value={`faq-${index}`}
                  className="glass-panel border-white/5 rounded-lg px-6"
                >
                  <AccordionTrigger className="hover:no-underline text-left">
                    <span className="text-gray-200">{faq.question}</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-gray-400 leading-relaxed pb-2">
                      {faq.answer}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* CTA Section */}
          <div className="mt-20 text-center glass-panel p-12 rounded-lg">
            <h2
              className="font-serif text-3xl text-white mb-4"
              style={{ fontFamily: "var(--font-cinzel), serif" }}
            >
              Ready to enforce your architecture?
            </h2>
            <p className="text-gray-400 mb-8 max-w-xl mx-auto">
              Start with our free tier and upgrade as your documentation needs
              grow. No credit card required.
            </p>
            <button className="glass-btn bg-violet-spectral/10 border-violet-spectral/50 text-white px-8 py-4 rounded-sm hover:bg-violet-spectral/20">
              Deploy Quoth Server
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
