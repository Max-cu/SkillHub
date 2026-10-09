import pg from 'pg';
import { postgresConfig } from './config.mjs';

let pool;
export function getPool() {
  if (!pool) {
    pool = new pg.Pool(postgresConfig());
    pool.on('error', () => console.error('SkillHub PostgreSQL pool connection failed.'));
  }
  return pool;
}
export async function assertDatabase(client = getPool()) {
  const { rows } = await client.query('SELECT current_database() AS database, current_user AS username, rolsuper FROM pg_roles WHERE rolname=current_user');
  if (rows[0]?.database !== 'skillhub' || rows[0]?.username !== 'skillhub_app' || rows[0]?.rolsuper) throw new Error('SkillHub database identity check failed; refusing access.');
}
