// src/components/mdx/MDXComponents.tsx

import { Callout } from './Callout';
import { Steps, Step } from './Steps';
import { Card, CardGrid } from './Card';

export const mdxComponents = {
  // Override default elements with neo-noir styling
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="text-3xl font-bold font-cinzel text-white mt-8 mb-4" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-2xl font-bold font-cinzel text-white mt-8 mb-3 scroll-mt-20" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-xl font-semibold text-white mt-6 mb-2 scroll-mt-20" {...props} />
  ),
  h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 className="text-lg font-semibold text-white mt-4 mb-2" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-gray-400 leading-relaxed mb-4" {...props} />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-violet-ghost hover:text-violet-spectral transition-colors underline underline-offset-2" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc list-inside text-gray-400 mb-4 space-y-1 ml-2" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal list-inside text-gray-400 mb-4 space-y-1 ml-2" {...props} />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li className="text-gray-400" {...props} />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code className="bg-charcoal px-1.5 py-0.5 rounded text-violet-ghost text-sm font-mono" {...props} />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="bg-charcoal border border-violet-spectral/20 rounded-lg p-4 overflow-x-auto my-4 text-sm" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-l-2 border-violet-spectral pl-4 italic text-gray-500 my-4" {...props} />
  ),
  hr: () => <hr className="border-violet-spectral/20 my-8" />,
  table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm text-gray-400" {...props} />
    </div>
  ),
  th: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className="border-b border-violet-spectral/20 px-4 py-2 text-left text-white font-semibold" {...props} />
  ),
  td: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className="border-b border-violet-spectral/10 px-4 py-2" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-white" {...props} />
  ),

  // Custom components
  Callout,
  Steps,
  Step,
  Card,
  CardGrid,
};
