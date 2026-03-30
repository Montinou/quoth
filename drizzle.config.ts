import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
  schemaFilter: ["public", "agents", "docs", "search", "analytics", "comms"],
  verbose: true,
  strict: true,
});
