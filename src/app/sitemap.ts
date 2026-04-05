import type { MetadataRoute } from 'next';
import { getAllPosts } from '@/lib/content/blog';
import { getDocsSidebar } from '@/lib/content/docs';
import { getAllComparisons } from '@/lib/content/compare';
import { getAllIntegrations } from '@/lib/content/integrations';
import { getAllTerms } from '@/lib/content/glossary';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://quoth.triqual.dev';

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/compare`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/integrations`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/glossary`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/changelog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/guide`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/protocol`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/manifesto`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
  ];

  // Dynamic blog posts
  let blogPages: MetadataRoute.Sitemap = [];
  try {
    const posts = await getAllPosts();
    blogPages = posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
  } catch {
    // Blog content may not be available at build time
  }

  // Dynamic doc pages
  let docPages: MetadataRoute.Sitemap = [];
  try {
    const sections = await getDocsSidebar();
    docPages = sections.flatMap((section) =>
      section.pages.map((page) => ({
        url: `${base}/docs/${page.slug.join('/')}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }))
    );
  } catch {
    // Doc content may not be available at build time
  }

  // Dynamic comparison pages
  let comparePages: MetadataRoute.Sitemap = [];
  try {
    const comparisons = await getAllComparisons();
    comparePages = comparisons.map((c) => ({
      url: `${base}/compare/${c.slug}`,
      lastModified: new Date(c.date),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    }));
  } catch {}

  // Dynamic integration pages
  let integrationPages: MetadataRoute.Sitemap = [];
  try {
    const integrations = await getAllIntegrations();
    integrationPages = integrations.map((i) => ({
      url: `${base}/integrations/${i.slug}`,
      lastModified: new Date(i.date),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    }));
  } catch {}

  // Dynamic glossary pages
  let glossaryPages: MetadataRoute.Sitemap = [];
  try {
    const terms = await getAllTerms();
    glossaryPages = terms.map((t) => ({
      url: `${base}/glossary/${t.slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
  } catch {}

  return [
    ...staticPages,
    ...blogPages,
    ...docPages,
    ...comparePages,
    ...integrationPages,
    ...glossaryPages,
  ];
}
