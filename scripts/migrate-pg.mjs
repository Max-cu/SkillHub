import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPool, assertDatabase } from '../db/postgres.mjs';

const pool = getPool(), client = await pool.connect();
try {
  await assertDatabase(client);
  await client.query("SELECT pg_advisory_lock(hashtext('skillhub:migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS skillhub_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const folder = new URL('../postgres/migrations/', import.meta.url);
  for (const name of readdirSync(folder).filter(n => /^\d+.*\.sql$/.test(n)).sort()) {
    const sql = readFileSync(new URL(name, folder), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const result = await client.query('SELECT checksum FROM skillhub_migrations WHERE name=$1', [name]);
    if (result.rows.length) {
      if (result.rows[0].checksum !== checksum) throw new Error(`Applied migration was changed: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO skillhub_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      await client.query('COMMIT');
      console.log(`Applied SkillHub PostgreSQL migration: ${name}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  console.log('SkillHub PostgreSQL schema is up to date.');
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('skillhub:migrations'))").catch(() => {});
  client.release();
  await pool.end();
}
