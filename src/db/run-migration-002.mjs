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
const migration = readFileSync('src/db/migrations/002_agent_memory.sql', 'utf8');

console.log(`Running migration 002 (${migration.length} chars, ${migration.split(';').length} statements)...`);

try {
  const client = await pool.connect();
  try {
    await client.query(migration);
    console.log('Migration 002 SUCCESS');

    // Verify table exists
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'agents' AND table_name = 'memory'
      ORDER BY ordinal_position;
    `);
    console.log(`\nVerification: agents.memory has ${result.rows.length} columns:`);
    for (const row of result.rows) {
      console.log(`  - ${row.column_name} (${row.data_type})`);
    }

    // Verify indexes
    const idxResult = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'agents' AND tablename = 'memory'
      ORDER BY indexname;
    `);
    console.log(`\nIndexes (${idxResult.rows.length}):`);
    for (const row of idxResult.rows) {
      console.log(`  - ${row.indexname}`);
    }

    // Verify functions
    const fnResult = await client.query(`
      SELECT routine_name FROM information_schema.routines
      WHERE routine_schema = 'agents'
        AND routine_name IN ('search_memory', 'apply_memory_decay', 'consolidate_memory', 'cleanup_memory')
      ORDER BY routine_name;
    `);
    console.log(`\nFunctions (${fnResult.rows.length}):`);
    for (const row of fnResult.rows) {
      console.log(`  - agents.${row.routine_name}`);
    }
  } finally {
    client.release();
  }
} catch (e) {
  console.error('Migration 002 FAILED:', e.message.substring(0, 500));
  process.exit(1);
} finally {
  await pool.end();
}
