// src/app/blog/page.tsx

import { Metadata } from 'next';
import Link from 'next/link';
import { getAllPosts, getFeaturedPost } from '@/lib/content/blog';
import { Navbar } from '@/components/quoth/Navbar';
import { Footer } from '@/components/quoth/Footer';
import { Calendar, Clock, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Blog | Quoth',
  description: 'Announcements, tutorials, and thoughts on AI-native documentation',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function BlogPage() {
  const posts = await getAllPosts();
  const featured = await getFeaturedPost();
  const otherPosts = posts.filter(p => p.slug !== featured?.slug);

  return (
    <div className="min-h-screen bg-obsidian">
      <Navbar />

      <main className="pt-24 pb-16 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold font-cinzel text-white mb-4">
              Quoth Blog
            </h1>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Announcements, tutorials, and thoughts on AI-native documentation
            </p>
          </div>

          {/* Featured Post */}
          {featured && (
            <Link
              href={`/blog/${featured.slug}`}
              className="block glass-panel rounded-2xl p-8 mb-12 group hover:border-violet-spectral/30 transition-all duration-300"
            >
              <div className="flex flex-wrap gap-2 mb-4">
                {featured.tags?.map(tag => (
                  <span
                    key={tag}
                    className="px-3 py-1 text-xs font-medium rounded-full bg-violet-spectral/15 text-violet-ghost border border-violet-spectral/30"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="text-2xl md:text-3xl font-bold font-cinzel text-white mb-3 group-hover:text-violet-ghost transition-colors">
                {featured.title}
              </h2>
              <p className="text-gray-400 mb-4 line-clamp-2">
                {featured.description}
              </p>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" strokeWidth={1.5} />
                  {formatDate(featured.date)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" strokeWidth={1.5} />
                  {featured.readingTime} min read
                </span>
                <span className="ml-auto text-violet-spectral flex items-center gap-1">
                  Read more <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </Link>
          )}

          {/* Posts Grid */}
          {otherPosts.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {otherPosts.map(post => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="glass-panel rounded-xl p-6 group hover:border-violet-spectral/30 transition-all duration-300"
                >
                  <div className="flex flex-wrap gap-2 mb-3">
                    {post.tags?.slice(0, 2).map(tag => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-xs font-medium rounded-full bg-violet-spectral/10 text-violet-ghost"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-violet-ghost transition-colors line-clamp-2">
                    {post.title}
                  </h3>
                  <p className="text-gray-500 text-sm mb-4 line-clamp-2">
                    {post.description}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-gray-600">
                    <span>{formatDate(post.date)}</span>
                    <span>•</span>
                    <span>{post.readingTime} min</span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Empty State */}
          {posts.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-500">No blog posts yet. Check back soon!</p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
