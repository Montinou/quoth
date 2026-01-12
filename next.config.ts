import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include WASM files in serverless function bundles for Vercel
  outputFileTracingIncludes: {
    // MCP routes that use AST chunking via search/sync
    "/api/mcp": ["./public/wasm/*.wasm"],
    "/api/mcp/*": ["./public/wasm/*.wasm"],
    "/api/\\[transport\\]": ["./public/wasm/*.wasm"],
  },
  // Empty turbopack config to silence warning about webpack migration
  turbopack: {},
};

export default nextConfig;
