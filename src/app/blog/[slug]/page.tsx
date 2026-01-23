// src/app/blog/[slug]/page.tsx

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPostBySlug, getAllPosts, getRelatedPosts } from '@/lib/content/blog';
import { MDXContent } from '@/components/mdx';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { Calendar, Clock, ArrowLeft } from 'lucide-react';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map(post => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) notFound();

  const relatedPosts = await getRelatedPosts(slug, post.tags || []);

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <article className="max-w-3xl mx-auto">
          {/* Back link */}
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-violet-ghost transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
            Back to Blog
          </Link>

          {/* Header */}
          <header className="mb-8">
            {/* Tags */}
            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags?.map(tag => (
                <span
                  key={tag}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-violet-spectral/15 text-violet-ghost border border-violet-spectral/30"
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Title */}
            <h1 className="text-3xl md:text-4xl font-bold font-cinzel text-white mb-4">
              {post.title}
            </h1>

            {/* Description */}
            <p className="text-xl text-gray-400 mb-6">
              {post.description}
            </p>

            {/* Meta */}
            <div className="flex items-center gap-4 text-sm text-gray-500 pb-6 border-b border-violet-spectral/20">
              <span className="text-white font-medium">{post.author}</span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" strokeWidth={1.5} />
                {formatDate(post.date)}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" strokeWidth={1.5} />
                {post.readingTime} min read
              </span>
            </div>
          </header>

          {/* Content */}
          <div className="prose-quoth">
            <MDXContent source={post.content} />
          </div>
        </article>

        {/* Related Posts */}
        {relatedPosts.length > 0 && (
          <section className="max-w-3xl mx-auto mt-16 pt-8 border-t border-violet-spectral/20">
            <h2 className="text-xl font-bold font-cinzel text-white mb-6">Related Posts</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {relatedPosts.map(related => (
                <Link
                  key={related.slug}
                  href={`/blog/${related.slug}`}
                  className="glass-panel rounded-lg p-4 group hover:border-violet-spectral/30 transition-all"
                >
                  <h3 className="font-semibold text-white mb-1 group-hover:text-violet-ghost transition-colors line-clamp-2">
                    {related.title}
                  </h3>
                  <p className="text-xs text-gray-500">{related.readingTime} min read</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}
