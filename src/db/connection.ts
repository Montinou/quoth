import { neon } from "@neondatabase/serverless";
import { drizzle, NeonHttpDatabase } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

// Singleton pattern: one Drizzle instance per runtime
let _db: NeonHttpDatabase<typeof schema> | null = null;

/**
 * Returns a cached Drizzle ORM instance connected to Neon.
 *
 * Uses DATABASE_URL (pooled) by default.
 * For migrations or operations that need session state (e.g. SET LOCAL),
 * use `getUnpooledDb()` instead.
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env or Vercel environment variables."
    );
  }

  const sql = neon(url);
  _db = drizzle(sql, { schema });
  return _db;
}

// Separate singleton for unpooled connections (migrations, session vars)
let _unpooledDb: NeonHttpDatabase<typeof schema> | null = null;

/**
 * Returns a Drizzle instance using the unpooled (direct) connection.
 * Required for:
 * - Running migrations
 * - SET LOCAL session variables (RLS with Clerk JWT claims)
 * - Advisory locks
 */
export function getUnpooledDb(): NeonHttpDatabase<typeof schema> {
  if (_unpooledDb) return _unpooledDb;

  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error(
      "DATABASE_URL_UNPOOLED is not set. Add it to .env or Vercel environment variables."
    );
  }

  const sql = neon(url);
  _unpooledDb = drizzle(sql, { schema });
  return _unpooledDb;
}

/**
 * Get a database connection with RLS session variables set.
 * Uses unpooled connection to support SET LOCAL per-request.
 *
 * Use this from all authenticated API routes. Cron/webhook routes
 * should use getDb() instead — the table owner bypasses RLS.
 *
 * @param orgId - Organization UUID from auth context
 * @param userId - Clerk user ID (optional, for user-scoped policies)
 */
export async function getSecureDb(orgId: string, userId?: string | null) {
  const db = getUnpooledDb();

  await db.execute(sql`SELECT set_config('app.org_id', ${orgId}, true)`);
  if (userId) {
    await db.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
  }

  return db;
}

// Re-export schema for convenience
export { schema };

// Convenience alias — callers should prefer getDb() for clarity
export { getDb as db };
