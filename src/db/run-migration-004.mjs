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
const migration = readFileSync('src/db/migrations/004_comms_fixes.sql', 'utf8');

console.log(`Running migration 004 (${migration.length} chars, ${migration.split(';').length} statements)...`);

try {
  const client = await pool.connect();
  try {
    await client.query(migration);
    console.log('Migration 004 SUCCESS');

    // Verify CHECK constraint includes new event types
    const checkResult = await client.query(`
      SELECT pg_get_constraintdef(oid) as constraint_def
      FROM pg_constraint
      WHERE conname = 'activity_event_type_check';
    `);
    if (checkResult.rows.length > 0) {
      const def = checkResult.rows[0].constraint_def;
      const hasWebhookRetry = def.includes('webhook_retry');
      const hasTaskAutoFailed = def.includes('task_auto_failed');
      const hasTaskReassigned = def.includes('task_reassigned');
      console.log(`\nVerification 1: CHECK constraint includes new events:`);
      console.log(`  - webhook_retry: ${hasWebhookRetry ? 'YES' : 'NO'}`);
      console.log(`  - task_auto_failed: ${hasTaskAutoFailed ? 'YES' : 'NO'}`);
      console.log(`  - task_reassigned: ${hasTaskReassigned ? 'YES' : 'NO'}`);
    } else {
      console.log('\nVerification 1: CHECK constraint NOT FOUND');
    }

    // Verify comms.auto_fail_overdue_tasks() exists
    const fnResult1 = await client.query(`
      SELECT routine_name, data_type
      FROM information_schema.routines
      WHERE routine_schema = 'comms'
        AND routine_name = 'auto_fail_overdue_tasks';
    `);
    console.log(`\nVerification 2: comms.auto_fail_overdue_tasks() exists: ${fnResult1.rows.length > 0 ? 'YES' : 'NO'}`);
    if (fnResult1.rows.length > 0) {
      console.log(`  - returns: ${fnResult1.rows[0].data_type}`);
    }

    // Verify agents.has_project_access() exists
    const fnResult2 = await client.query(`
      SELECT routine_name, data_type
      FROM information_schema.routines
      WHERE routine_schema = 'agents'
        AND routine_name = 'has_project_access';
    `);
    console.log(`\nVerification 3: agents.has_project_access() exists: ${fnResult2.rows.length > 0 ? 'YES' : 'NO'}`);
    if (fnResult2.rows.length > 0) {
      console.log(`  - returns: ${fnResult2.rows[0].data_type}`);
    }

  } finally {
    client.release();
  }
} catch (e) {
  console.error('Migration 004 FAILED:', e.message.substring(0, 500));
  process.exit(1);
} finally {
  await pool.end();
}
