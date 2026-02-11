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
