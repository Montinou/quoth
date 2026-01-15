import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds (The Void)
        obsidian: '#050505',
        charcoal: '#121212',
        // WARNING: graphite is a BACKGROUND color, NOT for text on dark backgrounds
        // Use text-gray-400 for readable body text on dark backgrounds
        graphite: '#262626',
        // Accents (The Magic) - Violet spectrum
        violet: {
          spectral: '#8B5CF6',
          glow: '#7C3AED',
          ghost: '#DDD6FE',
        },
        // Semantics (The Truth)
        emerald: {
          muted: '#10B981',
        },
        amber: {
          warning: '#F59E0B',
        },
        crimson: {
          void: '#991B1B',
        },
      },
      fontFamily: {
        serif: ['var(--font-cinzel)', 'Cinzel', 'serif'],
        sans: ['var(--font-geist-sans)', 'Geist Sans', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'Geist Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
