// src/lib/content/types.ts

export interface BlogPost {
  title: string;
  description: string;
  date: string;
  author: string;
  slug: string;
  tags?: string[];
  image?: string;
  featured?: boolean;
  draft?: boolean;
  readingTime?: number;
  content: string;
}

export interface ChangelogEntry {
  date: string;
  version?: string;
  title?: string;
  content: string;
}

export interface DocHeading {
  level: number;
  text: string;
  slug: string;
}

export interface DocPage {
  title: string;
  description: string;
  slug: string[];
  order?: number;
  icon?: string;
  draft?: boolean;
  content: string;
  headings: DocHeading[];
}

export interface DocSection {
  title: string;
  slug: string;
  pages: Pick<DocPage, 'title' | 'slug' | 'order'>[];
}
