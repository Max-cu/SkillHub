import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postgresConfig } from '../db/config.mjs';

test('database config accepts only SkillHub dedicated database and role', () => {
  const config = postgresConfig('postgresql://skillhub_app:example@skillhub-postgres:5432/skillhub');
  assert.equal(config.database,'skillhub');
  assert.equal(config.user,'skillhub_app');
  assert.equal(config.host,'skillhub-postgres');
  assert.equal(postgresConfig('postgresql://skillhub_app:example@127.0.0.1:5433/skillhub').port,5433);
});
test('database config refuses SkillGo targets, generic variables and URL overrides', () => {
  for (const value of ['', 'postgresql://skillgo:example@skillhub-postgres/skillhub', 'postgresql://skillhub_app:example@skillhub-postgres/skillgo', 'postgresql://skillhub_app:example@db/skillhub', 'postgresql://skillhub_app:example@skillgo-db-1/skillhub', 'postgresql://skillhub_app:example@127.0.0.1:5432/skillhub', 'postgresql://skillhub_app:example@skillhub-postgres/skillhub?host=skillgo-db-1']) assert.throws(() => postgresConfig(value));
  const before = process.env.SKILLHUB_DATABASE_URL, generic = process.env.DATABASE_URL;
  try {
    delete process.env.SKILLHUB_DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://skillgo:example@db/skillgo';
    assert.throws(() => postgresConfig());
  } finally {
    if (before === undefined) delete process.env.SKILLHUB_DATABASE_URL; else process.env.SKILLHUB_DATABASE_URL = before;
    if (generic === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = generic;
  }
});
