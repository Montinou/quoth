import Script from 'next/script';

export function OrganizationSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Quoth Labs',
    url: 'https://quoth.triqual.dev',
    logo: 'https://quoth.triqual.dev/icon.svg',
    description: 'AI-driven documentation auditor and MCP server for documentation-driven development.',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'hello@quoth.triqual.dev',
      contactType: 'customer service',
    },
  };

  return (
    <Script
      id="org-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function SoftwareApplicationSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Quoth',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cross-platform',
    description: 'MCP server that enforces consistency between codebases and documentation. Stop AI hallucinations.',
    url: 'https://quoth.triqual.dev',
    author: {
      '@type': 'Organization',
      name: 'Quoth Labs',
    },
    offers: [
      {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        name: 'Free',
        description: '50 documents, 3 MCP calls/min',
      },
      {
        '@type': 'Offer',
        price: '29',
        priceCurrency: 'USD',
        name: 'Pro',
        description: 'Unlimited documents, 100 MCP calls/min',
      },
    ],
    featureList: [
      'Semantic vector search',
      'Documentation drift detection',
      'MCP protocol support',
      'Multi-tenant isolation',
      'OAuth 2.1',
    ],
  };

  return (
    <Script
      id="software-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

interface FAQ {
  question: string;
  answer: string;
}

export function FAQPageSchema({ faqs }: { faqs: FAQ[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  return (
    <Script
      id="faq-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

interface BreadcrumbItem {
  name: string;
  url: string;
}

export function BreadcrumbSchema({ items }: { items: BreadcrumbItem[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <Script
      id="breadcrumb-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

interface ArticleSchemaProps {
  title: string;
  description: string;
  datePublished: string;
  author: string;
  url: string;
  image?: string;
}

export function ArticleSchema({ title, description, datePublished, author, url, image }: ArticleSchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    datePublished,
    dateModified: datePublished,
    author: { '@type': 'Person', name: author },
    publisher: { '@type': 'Organization', name: 'Quoth Labs', url: 'https://quoth.triqual.dev' },
    url,
    ...(image && { image }),
  };

  return (
    <Script
      id="article-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

interface ComparisonSchemaProps {
  title: string;
  description: string;
  items: string[];
  url: string;
}

export function ComparisonSchema({ title, description, items, url }: ComparisonSchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    description,
    url,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item,
    })),
  };

  return (
    <Script
      id="comparison-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

interface DefinedTermSchemaProps {
  term: string;
  definition: string;
  url: string;
}

export function DefinedTermSchema({ term, definition, url }: DefinedTermSchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: term,
    description: definition,
    url,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'Quoth AI & MCP Glossary',
      url: 'https://quoth.triqual.dev/glossary',
    },
  };

  return (
    <Script
      id="defined-term-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

interface HowToSchemaProps {
  name: string;
  description: string;
  steps: { name: string; text: string }[];
  url: string;
}

export function HowToSchema({ name, description, steps, url }: HowToSchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    description,
    url,
    step: steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step.name,
      text: step.text,
    })),
  };

  return (
    <Script
      id="howto-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
