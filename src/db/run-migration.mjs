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
const migration = readFileSync('src/db/migrations/001_multi_schema.sql', 'utf8');

console.log(`Running migration (${migration.length} chars, ${migration.split(';').length} statements)...`);

try {
  const client = await pool.connect();
  try {
    await client.query(migration);
    console.log('Migration SUCCESS');
  } finally {
    client.release();
  }
} catch (e) {
  console.error('Migration FAILED:', e.message.substring(0, 500));
  process.exit(1);
} finally {
  await pool.end();
}
