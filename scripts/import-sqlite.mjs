import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getPool, assertDatabase } from '../db/postgres.mjs';

// Operator-only import into a NEW, empty SkillHub database. Never merges or deletes data.
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/import-sqlite.mjs /path/to/skillhub-export.json');
const bytes = readFileSync(file), sourceHash = createHash('sha256').update(bytes).digest('hex');
const snapshot = JSON.parse(bytes.toString('utf8'));
const columns = {
  skills:['id','name','description','category','agents','tags','source','source_path','commit','license','owner','featured','created_at'],
  versions:['skill_id','version','markdown','digest','commit','changelog','created_at'],
  favorites:['user_id','skill_id','created_at'],
  api_keys:['id','user_id','name','hash','prefix','scope','created_at'],
  recipes:['id','user_id','name','task','agent','items','created_at'],
  messages:['id','owner','author','content','color','created_at','position_x','position_y'],
  packages:['skill_id','version','digest','size','filename','root','files'],
  package_chunks:['skill_id','version','chunk_index','content'],
};
if (snapshot.format !== 'skillhub-sqlite-v1' || !snapshot.tables || Object.keys(snapshot.tables).sort().join() !== Object.keys(columns).sort().join()) throw new Error('Not a complete SkillHub SQLite export.');
const canonical = rows => JSON.stringify(rows.map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key,Buffer.isBuffer(row[key])?{$binary:row[key].toString('base64')}:row[key]]))).map(row=>JSON.stringify(row)).sort());
const digest = rows => createHash('sha256').update(canonical(rows)).digest('hex');
const pool = getPool(), client = await pool.connect();
try {
  await assertDatabase(client);
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('skillhub:sqlite-import'))");
  await client.query('CREATE TABLE IF NOT EXISTS skillhub_imports (source_hash text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now())');
  if ((await client.query('SELECT source_hash FROM skillhub_imports WHERE source_hash=$1',[sourceHash])).rows.length) {
    await client.query('COMMIT');
    console.log('This SkillHub snapshot was already imported; no changes made.');
  } else {
    for (const [table,fields] of Object.entries(columns)) {
      if ((await client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rows.length) throw new Error(`Import requires an empty SkillHub database; ${table} contains data.`);
      if (!Array.isArray(snapshot.tables[table])) throw new Error(`Missing table: ${table}`);
      for (const row of snapshot.tables[table]) {
        if (Object.keys(row).sort().join() !== [...fields].sort().join()) throw new Error(`Unexpected columns in ${table}.`);
        const values = fields.map(field => table==='package_chunks' && field==='content' ? Buffer.from(row[field].$binary,'base64') : row[field]);
        await client.query(`INSERT INTO "${table}" (${fields.map(field=>`"${field}"`).join(',')}) VALUES (${fields.map((_,index)=>'$'+(index+1)).join(',')})`,values);
      }
    }
    for (const table of Object.keys(columns)) {
      const imported = (await client.query(`SELECT * FROM "${table}"`)).rows;
      if (digest(imported) !== digest(snapshot.tables[table])) throw new Error(`Migration content verification failed: ${table}`);
      console.log(`Verified ${table}: ${imported.length} rows, including exact binary content.`);
    }
    await client.query('INSERT INTO skillhub_imports(source_hash) VALUES($1)',[sourceHash]);
    await client.query('COMMIT');
    console.log('SkillHub SQLite data imported and verified in PostgreSQL.');
  }
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
