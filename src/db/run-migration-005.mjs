import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const migration = readFileSync(join(__dirname, 'migrations/005_rls.sql'), 'utf-8');

  console.log('Running migration 005: Row Level Security...');

  // Split by semicolons and execute each statement
  const statements = migration
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await sql(stmt);
    } catch (err) {
      // Log but continue — some statements might already exist
      console.warn(`Warning: ${err.message}`);
    }
  }

  console.log('Migration 005 complete.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
