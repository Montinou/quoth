# Quoth Documentation, Blog & Changelog Design

**Date:** 2026-01-23
**Status:** Draft
**Authors:** Agustin Montoya + Claude

---

## Executive Summary

This design document outlines a comprehensive content system for Quoth consisting of three interconnected content areas:

1. **Docs** - Structured technical documentation for the full user journey
2. **Blog** - Announcements, thought pieces, tutorials, and ecosystem news
3. **Changelog** - Date-based timeline of releases and improvements

**Goals:**
- Serve both developers evaluating Quoth AND daily power users
- Replace fake testimonials (Phase 4) with authentic, valuable content
- Improve SEO and discoverability
- Keep content versioned alongside code (MDX in repo)
- Maintain the neo-noir aesthetic while prioritizing readability

**Target Audience:**
- Developers evaluating Quoth (discovery, quick starts, "why Quoth")
- Developers using Quoth daily (advanced patterns, troubleshooting, deep dives)

---

## Content Architecture

### File Structure

```
/content
├── blog/
│   ├── 2026-01-23-introducing-phase2-intelligence.mdx
│   ├── 2026-01-15-why-ai-needs-documentation.mdx
│   ├── 2026-01-10-genesis-deep-dive.mdx
│   └── ...
├── changelog/
│   ├── 2026-01-23.mdx
│   ├── 2026-01-20.mdx
│   ├── 2026-01-15.mdx
│   └── ...
└── docs/
    ├── index.mdx                    # Docs landing page
    ├── getting-started/
    │   ├── what-is-quoth.mdx
    │   ├── quick-start.mdx
    │   └── core-concepts.mdx
    ├── guides/
    │   ├── genesis.mdx
    │   ├── using-the-plugin.mdx
    │   ├── writing-good-documentation.mdx
    │   └── team-collaboration.mdx
    ├── reference/
    │   ├── mcp-tools.mdx
    │   ├── prompts.mdx
    │   ├── plugin-hooks.mdx
    │   └── api-endpoints.mdx
    └── dashboard/
        ├── coverage-metrics.mdx
        ├── activity-analytics.mdx
        └── team-management.mdx
```

### URL Routes

| Route | Description |
|-------|-------------|
| `/blog` | Blog listing page |
| `/blog/[slug]` | Individual blog post |
| `/changelog` | Changelog timeline |
| `/docs` | Docs home with overview |
| `/docs/getting-started/quick-start` | Individual doc page |
| `/docs/[...slug]` | Catch-all for nested docs |

---

## MDX Configuration

### Dependencies to Add

```json
{
  "dependencies": {
    "@next/mdx": "^15.0.0",
    "@mdx-js/loader": "^3.0.0",
    "@mdx-js/react": "^3.0.0",
    "gray-matter": "^4.0.3",
    "next-mdx-remote": "^5.0.0",
    "rehype-slug": "^6.0.0",
    "rehype-autolink-headings": "^7.0.0",
    "rehype-pretty-code": "^0.13.0",
    "remark-gfm": "^4.0.0"
  }
}
```

### MDX Provider Setup

```typescript
// src/components/mdx/MDXComponents.tsx

import { Callout } from './Callout';
import { Steps } from './Steps';
import { Card, CardGrid } from './Card';
import { CodeBlock } from '@/components/quoth/CodeBlock';

export const mdxComponents = {
  // Override default elements
  h1: (props) => <h1 className="text-3xl font-bold font-cinzel text-white mt-8 mb-4" {...props} />,
  h2: (props) => <h2 className="text-2xl font-bold font-cinzel text-white mt-8 mb-3" {...props} />,
  h3: (props) => <h3 className="text-xl font-semibold text-white mt-6 mb-2" {...props} />,
  p: (props) => <p className="text-gray-400 leading-relaxed mb-4" {...props} />,
  a: (props) => <a className="text-violet-ghost hover:text-violet-spectral transition-colors" {...props} />,
  ul: (props) => <ul className="list-disc list-inside text-gray-400 mb-4 space-y-1" {...props} />,
  ol: (props) => <ol className="list-decimal list-inside text-gray-400 mb-4 space-y-1" {...props} />,
  code: (props) => <code className="bg-charcoal px-1.5 py-0.5 rounded text-violet-ghost text-sm" {...props} />,
  pre: (props) => <CodeBlock {...props} />,
  blockquote: (props) => (
    <blockquote className="border-l-2 border-violet-spectral pl-4 italic text-gray-500 my-4" {...props} />
  ),

  // Custom components
  Callout,
  Steps,
  Card,
  CardGrid,
};
```

---

## Frontmatter Schemas

### Blog Post Schema

```yaml
---
# Required
title: "Introducing Phase 2: Intelligence"
description: "Auto-inject patterns, audit code, and see coverage metrics in your dashboard"
date: 2026-01-23
author: "Agustin Montoya"

# Optional
tags: ["release", "plugin", "dashboard"]
image: "/blog/phase2-cover.png"      # OG image for social sharing
featured: true                         # Shows prominently on listing
draft: false                           # Set true to hide from production
readingTime: 5                         # Auto-calculated if not provided
---
```

**TypeScript Interface:**

```typescript
interface BlogPost {
  title: string;
  description: string;
  date: string;           // ISO date string
  author: string;
  slug: string;           // Derived from filename
  tags?: string[];
  image?: string;
  featured?: boolean;
  draft?: boolean;
  readingTime?: number;
  content: string;        // MDX content
}
```

### Changelog Entry Schema

```yaml
---
date: 2026-01-23
version: "0.2.0"          # Optional - for tagging releases
title: "Phase 2: Intelligence"  # Optional - for major releases
---

## Added
- CoverageCard component showing documentation coverage metrics
- ActivityCard component with usage analytics
- Claude Code plugin with 6 hooks (SessionStart, PreToolUse, PostToolUse, Stop)
- Activity logging for all MCP tool calls
- Convention-based coverage calculation

## Changed
- Dashboard layout now includes Coverage and Activity sections
- Sidebar navigation includes Coverage link

## Fixed
- Search relevance scoring improved with Cohere reranking
```

**TypeScript Interface:**

```typescript
interface ChangelogEntry {
  date: string;           // ISO date string
  version?: string;
  title?: string;
  content: string;        // MDX content with ## Added, ## Changed, ## Fixed sections
}
```

### Doc Page Schema

```yaml
---
# Required
title: "Quick Start"
description: "Get Quoth running in 5 minutes"

# Optional
order: 2                  # Controls sidebar ordering (lower = higher)
icon: "Zap"              # Lucide icon name for sidebar
draft: false             # Set true to hide from production
---
```

**TypeScript Interface:**

```typescript
interface DocPage {
  title: string;
  description: string;
  slug: string[];         // Path segments, e.g., ["getting-started", "quick-start"]
  order?: number;
  icon?: string;
  draft?: boolean;
  content: string;        // MDX content
  headings: Array<{       // Extracted for table of contents
    level: number;
    text: string;
    slug: string;
  }>;
}
```

---

## Custom MDX Components

### Callout Component

```typescript
// src/components/mdx/Callout.tsx

import { Info, AlertTriangle, Lightbulb, AlertCircle } from 'lucide-react';

type CalloutType = 'info' | 'warning' | 'tip' | 'danger';

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}

const styles: Record<CalloutType, { icon: any; bg: string; border: string; title: string }> = {
  info: {
    icon: Info,
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    title: 'text-blue-400',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-warning/10',
    border: 'border-amber-warning/30',
    title: 'text-amber-warning',
  },
  tip: {
    icon: Lightbulb,
    bg: 'bg-emerald-muted/10',
    border: 'border-emerald-muted/30',
    title: 'text-emerald-muted',
  },
  danger: {
    icon: AlertCircle,
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    title: 'text-red-400',
  },
};

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const style = styles[type];
  const Icon = style.icon;

  return (
    <div className={`${style.bg} ${style.border} border rounded-lg p-4 my-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${style.title} mt-0.5 shrink-0`} />
        <div>
          {title && <p className={`font-semibold ${style.title} mb-1`}>{title}</p>}
          <div className="text-gray-400 text-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
```

**Usage in MDX:**

```mdx
<Callout type="tip" title="Pro Tip">
  Use `/prompt quoth_architect` before writing any code to enforce documented patterns.
</Callout>

<Callout type="warning">
  Genesis will overwrite existing documentation files. Back up first!
</Callout>
```

### Steps Component

```typescript
// src/components/mdx/Steps.tsx

interface StepsProps {
  children: React.ReactNode;
}

interface StepProps {
  title: string;
  children: React.ReactNode;
}

export function Steps({ children }: StepsProps) {
  return (
    <div className="space-y-6 my-6">
      {children}
    </div>
  );
}

export function Step({ title, children }: StepProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-violet-spectral/20 border border-violet-spectral/30 flex items-center justify-center text-violet-ghost font-semibold text-sm">
          {/* Number injected via CSS counter */}
        </div>
        <div className="w-px h-full bg-violet-spectral/20 mt-2" />
      </div>
      <div className="flex-1 pb-6">
        <h4 className="font-semibold text-white mb-2">{title}</h4>
        <div className="text-gray-400 text-sm">{children}</div>
      </div>
    </div>
  );
}
```

**Usage in MDX:**

```mdx
<Steps>
  <Step title="Install Quoth MCP">
    Run `claude mcp add quoth` in your terminal.
  </Step>
  <Step title="Authenticate">
    Follow the OAuth flow to connect your account.
  </Step>
  <Step title="Run Genesis">
    Use `/prompt quoth_architect` and ask to run Genesis.
  </Step>
</Steps>
```

### Card Components

```typescript
// src/components/mdx/Card.tsx

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import * as Icons from 'lucide-react';

interface CardProps {
  title: string;
  description: string;
  href: string;
  icon?: string;
}

export function Card({ title, description, href, icon }: CardProps) {
  const Icon = icon ? (Icons as any)[icon] : null;

  return (
    <Link
      href={href}
      className="glass-panel rounded-xl p-5 group hover:border-violet-spectral/30 transition-all"
    >
      {Icon && (
        <div className="p-2 rounded-lg bg-violet-spectral/15 w-fit mb-3">
          <Icon className="w-5 h-5 text-violet-spectral" />
        </div>
      )}
      <h3 className="font-semibold text-white mb-1 group-hover:text-violet-ghost transition-colors">
        {title}
      </h3>
      <p className="text-sm text-gray-500 mb-3">{description}</p>
      <span className="text-sm text-violet-spectral flex items-center gap-1">
        Learn more <ArrowRight className="w-3 h-3" />
      </span>
    </Link>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
      {children}
    </div>
  );
}
```

**Usage in MDX:**

```mdx
<CardGrid>
  <Card
    title="Quick Start"
    description="Get Quoth running in 5 minutes"
    href="/docs/getting-started/quick-start"
    icon="Zap"
  />
  <Card
    title="Core Concepts"
    description="Understand how Quoth works"
    href="/docs/getting-started/core-concepts"
    icon="BookOpen"
  />
</CardGrid>
```

---

## Page Layouts

### Blog Listing Page (`/blog`)

```
┌─────────────────────────────────────────────────────────────────┐
│  [Navbar]                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  🔮 Quoth Blog                                              ││
│  │  Announcements, tutorials, and thoughts on AI documentation ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  [Featured Post - Large Card with Image]                    ││
│  │  "Introducing Phase 2: Intelligence"                        ││
│  │  Jan 23, 2026 • 5 min read • release, plugin               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │  [Post Card]    │ │  [Post Card]    │ │  [Post Card]    │   │
│  │  Title          │ │  Title          │ │  Title          │   │
│  │  Description    │ │  Description    │ │  Description    │   │
│  │  Date • Tags    │ │  Date • Tags    │ │  Date • Tags    │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│                                                                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │  [Post Card]    │ │  [Post Card]    │ │  [Post Card]    │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Footer]                                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Featured post prominently displayed at top
- 3-column grid on desktop, 1 column on mobile
- Each card shows: title, description, date, read time, tags
- Tags are clickable for filtering (future enhancement)
- Pagination or "Load more" for older posts

### Blog Post Page (`/blog/[slug]`)

```
┌─────────────────────────────────────────────────────────────────┐
│  [Navbar]                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│           ┌─────────────────────────────────────────┐           │
│           │  release  plugin  dashboard             │           │
│           │                                         │           │
│           │  Introducing Phase 2: Intelligence      │           │
│           │                                         │           │
│           │  Auto-inject patterns, audit code,      │           │
│           │  and see coverage metrics               │           │
│           │                                         │           │
│           │  Agustin Montoya • Jan 23, 2026 • 5 min │           │
│           └─────────────────────────────────────────┘           │
│                                                                  │
│           ┌─────────────────────────────────────────┐           │
│           │                                         │           │
│           │  [MDX Content - max-width 720px]        │           │
│           │                                         │           │
│           │  ## What's New in Phase 2               │           │
│           │                                         │           │
│           │  Phase 2 brings intelligence to Quoth   │           │
│           │  with automatic pattern injection...    │           │
│           │                                         │           │
│           │  <Callout type="tip">...</Callout>      │           │
│           │                                         │           │
│           │  ```typescript                          │           │
│           │  // Code example                        │           │
│           │  ```                                    │           │
│           │                                         │           │
│           └─────────────────────────────────────────┘           │
│                                                                  │
│           ┌─────────────────────────────────────────┐           │
│           │  Related Posts                          │           │
│           │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │           │
│           │  │ Post 1  │ │ Post 2  │ │ Post 3  │   │           │
│           │  └─────────┘ └─────────┘ └─────────┘   │           │
│           └─────────────────────────────────────────┘           │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Footer]                                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Clean, focused reading layout (max-width ~720px)
- Tags displayed as badges at top
- Author, date, and reading time
- MDX content with custom components
- Related posts section at bottom (same tags or manually specified)

### Changelog Page (`/changelog`)

```
┌─────────────────────────────────────────────────────────────────┐
│  [Navbar]                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  🔮 Changelog                                               ││
│  │  Track Quoth's evolution                                    ││
│  │                                          [Subscribe to RSS] ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  January 2026                                                    │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  ┌──────┐ ┌─────────────────────────────────────────────────┐  │
│  │      │ │  v0.2.0  Phase 2: Intelligence                  │  │
│  │ Jan  │ │                                                  │  │
│  │ 23   │ │  ## Added                                        │  │
│  │      │ │  - CoverageCard component                        │  │
│  │  ●   │ │  - ActivityCard component                        │  │
│  │  │   │ │  - Claude Code plugin with 6 hooks               │  │
│  │  │   │ │                                                  │  │
│  │  │   │ │  ## Changed                                      │  │
│  │  │   │ │  - Dashboard layout updated                      │  │
│  └──┼───┘ └─────────────────────────────────────────────────┘  │
│     │                                                            │
│  ┌──┼───┐ ┌─────────────────────────────────────────────────┐  │
│  │  │   │ │  Bug fixes and improvements                      │  │
│  │ Jan  │ │                                                  │  │
│  │ 20   │ │  ## Fixed                                        │  │
│  │      │ │  - OAuth token refresh issue                     │  │
│  │  ●   │ │  - Search ranking improvements                   │  │
│  │  │   │ │                                                  │  │
│  └──┼───┘ └─────────────────────────────────────────────────┘  │
│     │                                                            │
│     ▼                                                            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Footer]                                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Vertical timeline with dates on left
- Version badges for releases
- Entries grouped by month
- Expandable/collapsible entries (optional)
- RSS feed link for subscribers
- Clean, scannable format

### Docs Layout (`/docs/[...slug]`)

```
┌─────────────────────────────────────────────────────────────────┐
│  [Navbar]                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────┬─────────────────────────────────┬───────────┐   │
│  │           │                                 │           │   │
│  │  Sidebar  │  Content                        │  TOC      │   │
│  │           │                                 │           │   │
│  │  Getting  │  # Quick Start                  │  On this  │   │
│  │  Started  │                                 │  page     │   │
│  │  ├ What   │  Get Quoth running in 5 min... │           │   │
│  │  ├ Quick* │                                 │  Overview │   │
│  │  └ Core   │  ## Prerequisites               │  Prereqs  │   │
│  │           │                                 │  Install  │   │
│  │  Guides   │  - Node.js 18+                  │  Auth     │   │
│  │  ├ Gene.. │  - Claude Code CLI              │  Genesis  │   │
│  │  ├ Plugin │                                 │           │   │
│  │  ├ Writ.. │  ## Installation                │           │   │
│  │  └ Team   │                                 │           │   │
│  │           │  ```bash                        │           │   │
│  │  Refer..  │  claude mcp add quoth           │           │   │
│  │  ├ MCP    │  ```                            │           │   │
│  │  ├ Prom.. │                                 │           │   │
│  │  ├ Hooks  │  <Callout type="tip">           │           │   │
│  │  └ API    │    Use OAuth for easiest setup  │           │   │
│  │           │  </Callout>                     │           │   │
│  │  Dashb..  │                                 │           │   │
│  │  ├ Cove.. │  ## Authentication              │           │   │
│  │  ├ Acti.. │                                 │           │   │
│  │  └ Team   │  ...                            │           │   │
│  │           │                                 │           │   │
│  │           │  ┌─────────────────────────┐   │           │   │
│  │           │  │ ← Previous    Next →    │   │           │   │
│  │           │  │ What is...   Core Con.. │   │           │   │
│  │           │  └─────────────────────────┘   │           │   │
│  │           │                                 │           │   │
│  └───────────┴─────────────────────────────────┴───────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  [Footer]                                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Left sidebar: Collapsible navigation organized by section
- Center: MDX content with custom components
- Right sidebar: Table of contents (extracted from headings)
- Previous/Next navigation at bottom
- Search functionality (can use existing Quoth search!)
- Mobile: Hamburger menu for sidebar, TOC hidden or in dropdown
- Breadcrumbs at top (Docs > Getting Started > Quick Start)
- Edit on GitHub link (optional)

---

## Docs Section Structure

### Getting Started

| Page | Description | Order |
|------|-------------|-------|
| `what-is-quoth.mdx` | Overview, value proposition, how it works | 1 |
| `quick-start.mdx` | 5-minute setup guide | 2 |
| `core-concepts.mdx` | Key concepts: Genesis, patterns, drift, coverage | 3 |

### Guides

| Page | Description | Order |
|------|-------------|-------|
| `genesis.mdx` | Deep dive into Genesis, depth levels, customization | 1 |
| `using-the-plugin.mdx` | Claude Code plugin installation, hooks, badge | 2 |
| `writing-good-documentation.mdx` | Best practices for Quoth docs | 3 |
| `team-collaboration.mdx` | Multi-user setup, roles, invitations | 4 |

### Reference

| Page | Description | Order |
|------|-------------|-------|
| `mcp-tools.mdx` | All MCP tools: search, read, propose, genesis, templates | 1 |
| `prompts.mdx` | Architect, auditor, documenter personas | 2 |
| `plugin-hooks.mdx` | SessionStart, PreToolUse, PostToolUse, Stop | 3 |
| `api-endpoints.mdx` | REST API reference for dashboard/integrations | 4 |

### Dashboard

| Page | Description | Order |
|------|-------------|-------|
| `coverage-metrics.mdx` | Understanding coverage calculation, categories | 1 |
| `activity-analytics.mdx` | Usage stats, miss rate, top searches | 2 |
| `team-management.mdx` | Invitations, roles, permissions | 3 |

---

## Content Utilities

### Content Loading Functions

```typescript
// src/lib/content/blog.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const BLOG_DIR = path.join(process.cwd(), 'content/blog');

export async function getAllPosts(): Promise<BlogPost[]> {
  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.mdx'));

  const posts = files.map(filename => {
    const filePath = path.join(BLOG_DIR, filename);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(fileContent);

    return {
      ...data,
      slug: filename.replace('.mdx', ''),
      content,
    } as BlogPost;
  });

  return posts
    .filter(p => !p.draft)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);

  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);

  return {
    ...data,
    slug,
    content,
  } as BlogPost;
}

export async function getFeaturedPost(): Promise<BlogPost | null> {
  const posts = await getAllPosts();
  return posts.find(p => p.featured) || posts[0] || null;
}
```

```typescript
// src/lib/content/docs.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const DOCS_DIR = path.join(process.cwd(), 'content/docs');

interface DocSection {
  title: string;
  slug: string;
  pages: DocPage[];
}

export async function getDocsSidebar(): Promise<DocSection[]> {
  const sections = ['getting-started', 'guides', 'reference', 'dashboard'];

  return sections.map(section => {
    const sectionDir = path.join(DOCS_DIR, section);
    const files = fs.readdirSync(sectionDir).filter(f => f.endsWith('.mdx'));

    const pages = files.map(filename => {
      const filePath = path.join(sectionDir, filename);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const { data } = matter(fileContent);

      return {
        title: data.title,
        slug: [section, filename.replace('.mdx', '')],
        order: data.order || 99,
      };
    }).sort((a, b) => a.order - b.order);

    return {
      title: formatSectionTitle(section),
      slug: section,
      pages,
    };
  });
}

export async function getDocBySlug(slugParts: string[]): Promise<DocPage | null> {
  const filePath = path.join(DOCS_DIR, ...slugParts) + '.mdx';

  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);

  // Extract headings for TOC
  const headings = extractHeadings(content);

  return {
    ...data,
    slug: slugParts,
    content,
    headings,
  } as DocPage;
}

function extractHeadings(content: string) {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2],
      slug: match[2].toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, ''),
    });
  }

  return headings;
}
```

```typescript
// src/lib/content/changelog.ts

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const CHANGELOG_DIR = path.join(process.cwd(), 'content/changelog');

export async function getAllChangelogs(): Promise<ChangelogEntry[]> {
  const files = fs.readdirSync(CHANGELOG_DIR).filter(f => f.endsWith('.mdx'));

  const entries = files.map(filename => {
    const filePath = path.join(CHANGELOG_DIR, filename);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(fileContent);

    return {
      ...data,
      date: data.date || filename.replace('.mdx', ''),
      content,
    } as ChangelogEntry;
  });

  return entries.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function groupChangelogsByMonth(entries: ChangelogEntry[]) {
  const grouped: Record<string, ChangelogEntry[]> = {};

  entries.forEach(entry => {
    const date = new Date(entry.date);
    const monthKey = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    });

    if (!grouped[monthKey]) grouped[monthKey] = [];
    grouped[monthKey].push(entry);
  });

  return grouped;
}
```

---

## Navigation Updates

### Add to Navbar

```typescript
// Update src/components/quoth/Navbar.tsx

const navLinks = [
  { href: '/docs', label: 'Docs' },
  { href: '/blog', label: 'Blog' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/pricing', label: 'Pricing' },
];
```

### Add to Footer

```typescript
// Update src/components/quoth/Footer.tsx

const footerSections = [
  {
    title: 'Product',
    links: [
      { href: '/docs/getting-started/quick-start', label: 'Quick Start' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/docs', label: 'Documentation' },
      { href: '/blog', label: 'Blog' },
      { href: '/docs/reference/mcp-tools', label: 'API Reference' },
    ],
  },
  // ... existing sections
];
```

---

## SEO & Metadata

### Dynamic Metadata Generation

```typescript
// src/app/blog/[slug]/page.tsx

import { Metadata } from 'next';
import { getPostBySlug } from '@/lib/content/blog';

export async function generateMetadata({ params }): Promise<Metadata> {
  const post = await getPostBySlug(params.slug);

  if (!post) return { title: 'Post Not Found' };

  return {
    title: `${post.title} | Quoth Blog`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author],
      images: post.image ? [post.image] : ['/og-default.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  };
}
```

### Sitemap Generation

```typescript
// src/app/sitemap.ts

import { MetadataRoute } from 'next';
import { getAllPosts } from '@/lib/content/blog';
import { getDocsSidebar } from '@/lib/content/docs';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://quoth.triqual.dev';

  // Static pages
  const staticPages = [
    '', '/docs', '/blog', '/changelog', '/pricing', '/guide', '/protocol',
  ].map(path => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
  }));

  // Blog posts
  const posts = await getAllPosts();
  const blogPages = posts.map(post => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: 'monthly' as const,
  }));

  // Doc pages
  const sidebar = await getDocsSidebar();
  const docPages = sidebar.flatMap(section =>
    section.pages.map(page => ({
      url: `${baseUrl}/docs/${page.slug.join('/')}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
    }))
  );

  return [...staticPages, ...blogPages, ...docPages];
}
```

---

## Initial Content Plan

### Launch Content (Day 1)

**Blog Posts:**
1. "Introducing Phase 2: Intelligence" - Announcement of new features
2. "Why Your AI Hallucinates (And How to Fix It)" - Thought leadership

**Changelog:**
1. Phase 2 release entry with all features listed

**Docs (Essential):**
1. What is Quoth?
2. Quick Start
3. Core Concepts
4. MCP Tools Reference

### Week 1 Content

**Blog:**
3. "Genesis Deep Dive: How We Bootstrap Docs in Minutes"

**Docs:**
5. Genesis Guide
6. Using the Plugin
7. Prompts Reference

### Week 2+ Content

**Blog:**
4. "Building a Claude Code Plugin from Scratch"
5. "The Documentation Coverage Gap in Modern Codebases"

**Docs (Complete):**
- All remaining guides and reference pages
- Dashboard documentation

---

## Implementation Phases

### Phase 1: Infrastructure (Foundation)

- [ ] Install MDX dependencies
- [ ] Create `/content` directory structure
- [ ] Implement content loading utilities
- [ ] Create MDX component provider
- [ ] Build custom components (Callout, Steps, Card)

### Phase 2: Blog System

- [ ] Create `/blog` listing page
- [ ] Create `/blog/[slug]` post page
- [ ] Add blog post metadata/SEO
- [ ] Write initial blog posts (2-3)

### Phase 3: Changelog System

- [ ] Create `/changelog` timeline page
- [ ] Implement month grouping
- [ ] Add RSS feed endpoint
- [ ] Write initial changelog entries

### Phase 4: Documentation System

- [ ] Create `/docs` layout with sidebar
- [ ] Create `/docs/[...slug]` page
- [ ] Implement TOC extraction
- [ ] Add previous/next navigation
- [ ] Write essential docs (4-5 pages)

### Phase 5: Polish & SEO

- [ ] Update Navbar/Footer navigation
- [ ] Generate sitemap
- [ ] Add OpenGraph images
- [ ] Mobile responsive testing
- [ ] Complete remaining docs

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Docs pages | 15+ pages covering full product |
| Blog posts | 5+ posts at launch, 2/month ongoing |
| Changelog entries | Updated with each release |
| Organic search traffic | Track via analytics |
| Time on docs pages | > 2 minutes average |
| Docs search usage | Track queries and results |

---

## Open Questions

1. **Search within docs** - Use existing Quoth search or add client-side search (e.g., Algolia, Pagefind)?
2. **Versioned docs** - Do we need docs versioning for different Quoth versions?
3. **Community contributions** - Should we enable "Edit on GitHub" for docs?
4. **i18n** - Any plans for internationalization?

---

## Appendix: Example Content

### Example Blog Post

```mdx
---
title: "Introducing Phase 2: Intelligence"
description: "Auto-inject patterns, audit code, and see coverage metrics in your dashboard"
date: 2026-01-23
author: "Agustin Montoya"
tags: ["release", "plugin", "dashboard"]
featured: true
---

We're excited to announce **Phase 2** of Quoth's evolution: Intelligence.

This release transforms Quoth from a documentation tool into an intelligent coding companion that actively helps you write better code.

## What's New

### Claude Code Plugin

The new Quoth plugin for Claude Code runs silently in the background, making every AI interaction documentation-aware:

<Callout type="tip">
  Install with one command: `claude plugins install quoth`
</Callout>

**Hooks in action:**

- **SessionStart**: Detects your project and loads relevant patterns
- **PreToolUse**: Injects documented patterns before code generation
- **PostToolUse**: Audits generated code against your documentation
- **Stop**: Shows the Quoth Badge summarizing what happened

### Coverage Dashboard

See exactly what's documented and what's not:

![Coverage Dashboard](/blog/phase2-coverage.png)

The new Coverage view shows documentation coverage by category...
```

### Example Doc Page

```mdx
---
title: "Quick Start"
description: "Get Quoth running in 5 minutes"
order: 2
---

# Quick Start

Get Quoth integrated with Claude Code in under 5 minutes.

## Prerequisites

- Node.js 18 or higher
- Claude Code CLI installed
- A codebase you want to document

## Installation

<Steps>
  <Step title="Add Quoth MCP Server">
    Run this command in your terminal:

    ```bash
    claude mcp add quoth
    ```
  </Step>

  <Step title="Authenticate">
    When prompted, click "Authenticate" to connect your Quoth account via OAuth.

    <Callout type="info">
      No account yet? One will be created automatically.
    </Callout>
  </Step>

  <Step title="Run Genesis">
    Start a new Claude Code session and say:

    ```
    /prompt quoth_architect
    Run Genesis to document this project
    ```

    Genesis will analyze your codebase and create initial documentation.
  </Step>
</Steps>

## Next Steps

<CardGrid>
  <Card
    title="Core Concepts"
    description="Understand patterns, drift, and coverage"
    href="/docs/getting-started/core-concepts"
    icon="BookOpen"
  />
  <Card
    title="Genesis Guide"
    description="Customize your documentation depth"
    href="/docs/guides/genesis"
    icon="Sparkles"
  />
</CardGrid>
```

### Example Changelog Entry

```mdx
---
date: 2026-01-23
version: "0.2.0"
title: "Phase 2: Intelligence"
---

## Added

- **CoverageCard**: New dashboard component showing documentation coverage by category
- **ActivityCard**: Usage analytics with search counts, miss rate, and top queries
- **Claude Code Plugin**: Full hook system for intelligent code assistance
  - SessionStart: Project detection and context loading
  - PreToolUse: Pattern injection before code generation
  - PostToolUse: Code audit against documentation
  - Stop: Quoth Badge showing patterns applied
- **Activity Logging**: All MCP tool usage now tracked for analytics
- **Coverage API**: New endpoints for triggering and fetching coverage scans

## Changed

- Dashboard layout now includes Coverage and Activity sections
- Sidebar navigation includes new Coverage link
- Stagger animations updated for new sections

## Database

- Added `quoth_activity` table for usage tracking
- Added `coverage_snapshot` table with computed percentage
```

---

**End of Design Document**
