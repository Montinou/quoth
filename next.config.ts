import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimize package imports for faster cold starts and dev boot
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Ensure tree-sitter packages are resolved server-side (not bundled)
  // This lets the lazy-loader dynamically import them at runtime
  serverExternalPackages: ['web-tree-sitter'],
  // Include WASM files in serverless function bundles for Vercel
  // Language grammars are loaded on-demand by lazy-loader — all must be traced
  outputFileTracingIncludes: {
    // MCP routes that use AST chunking via search/sync
    "/api/mcp": ["./public/wasm/*.wasm"],
    "/api/mcp/*": ["./public/wasm/*.wasm"],
    "/api/\\[transport\\]": ["./public/wasm/*.wasm"],
    // Sync endpoint also triggers chunking
    "/api/sync": ["./public/wasm/*.wasm"],
  },
  // Empty turbopack config to silence warning about webpack migration
  turbopack: {},
  // Security headers for production hardening
  headers: async () => [
    {
      // Apply to all routes
      source: '/:path*',
      headers: [
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'X-XSS-Protection',
          value: '1; mode=block',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=()',
        },
      ],
    },
    {
      // Stricter headers for API routes
      source: '/api/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-store, max-age=0',
        },
      ],
    },
  ],
};

export default nextConfig;
