import type { Pool, PoolClient } from 'pg';
import { getPool, assertDatabase } from './postgres.mjs';

export class PgStatement {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) {
    return new PgStatement(this.sql, values.map(value => value instanceof ArrayBuffer ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : value));
  }
  async execute(client: Pool | PoolClient = getPool()) { return client.query(this.sql, this.values); }
  async first<T>() { return (await this.execute()).rows[0] as T | null ?? null; }
  async all<T>() { return { results: (await this.execute()).rows as T[] }; }
  async run() { return { meta: { changes: (await this.execute()).rowCount ?? 0 } }; }
}
export function getDb() {
  return {
    prepare: (sql: string) => new PgStatement(sql),
    async batch(statements: PgStatement[]) {
      const client = await getPool().connect();
      try {
        await assertDatabase(client);
        await client.query('BEGIN');
        for (const statement of statements) await statement.execute(client);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
