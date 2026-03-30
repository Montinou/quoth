import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import ws from 'ws';

// Load .env.local
config({ path: '.env.local' });

const raw = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!raw) {
  console.error('No DATABASE_URL found in .env.local');
  process.exit(1);
}

// Clean the URL
const url = raw.replace(/[\r\n]/g, '').trim();
console.log('Connecting to:', url.replace(/:[^@]+@/, ':***@').substring(0, 70) + '...');

// Use WebSocket Pool for multi-statement support
const pool = new Pool({ connectionString: url, webSocketConstructor: ws });
const migration = readFileSync('src/db/migrations/003_memory_fixes.sql', 'utf8');

console.log(`Running migration 003 (${migration.length} chars, ${migration.split(';').length} statements)...`);

try {
  const client = await pool.connect();
  try {
    await client.query(migration);
    console.log('Migration 003 SUCCESS');

    // Verify search_memory() returns correct columns
    const fnResult = await client.query(`
      SELECT parameter_name, data_type
      FROM information_schema.parameters
      WHERE specific_schema = 'agents'
        AND specific_name LIKE 'search_memory%'
        AND parameter_mode = 'OUT'
      ORDER BY ordinal_position;
    `);
    console.log(`\nVerification 1: search_memory() output columns (${fnResult.rows.length}):`);
    for (const row of fnResult.rows) {
      console.log(`  - ${row.parameter_name} (${row.data_type})`);
    }

    // Verify CHECK constraint includes new event types
    const checkResult = await client.query(`
      SELECT pg_get_constraintdef(oid) as constraint_def
      FROM pg_constraint
      WHERE conname = 'activity_event_type_check';
    `);
    if (checkResult.rows.length > 0) {
      const def = checkResult.rows[0].constraint_def;
      const hasMemoryStore = def.includes('memory_store');
      const hasCacheCleanup = def.includes('cache_cleanup');
      console.log(`\nVerification 2: CHECK constraint includes memory events: ${hasMemoryStore && hasCacheCleanup ? 'YES' : 'NO'}`);
    } else {
      console.log('\nVerification 2: CHECK constraint NOT FOUND');
    }

    // Verify new index exists
    const idxResult = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'agents' AND tablename = 'memory'
        AND indexname = 'idx_memory_agent_tier_relevance';
    `);
    console.log(`\nVerification 3: idx_memory_agent_tier_relevance exists: ${idxResult.rows.length > 0 ? 'YES' : 'NO'}`);

  } finally {
    client.release();
  }
} catch (e) {
  console.error('Migration 003 FAILED:', e.message.substring(0, 500));
  process.exit(1);
} finally {
  await pool.end();
}
