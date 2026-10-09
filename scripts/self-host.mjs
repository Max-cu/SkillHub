import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readAuthConfig } from '../lib/cas-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const mode = process.argv[2];
if (!['serve','migrate'].includes(mode)) throw new Error('Expected serve or migrate.');
const port = Number(process.env.SKILLHUB_PORT || 3356);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SKILLHUB_PORT.');
for (const origin of (process.env.SKILLHUB_WORKSPACE_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('Workspace origins must be exact http(s) origins.');
}
if (mode === 'migrate') {
  const child = spawn(process.execPath, [path.join(root,'scripts/migrate-pg.mjs')], {stdio:'inherit'});
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  readAuthConfig();
  const { assertDatabase } = await import('../db/postgres.mjs');
  await assertDatabase();
  const { readAiConfig }=await import('../lib/ai-service.mjs');
  if(readAiConfig().enabled) {
    let ending=false,worker;
    const startWorker=()=>{worker=spawn(process.execPath,[path.join(root,'scripts/ai-review-worker.mjs')],{stdio:'inherit'});worker.on('exit',()=>{if(!ending)setTimeout(startWorker,3000);});};
    startWorker();for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{ending=true;worker?.kill(signal);});
  }
  // Use Vinext's native Node server; no local Worker simulator or SQLite.
  process.argv = [process.execPath, path.join(root,'node_modules/vinext/dist/cli.js'), 'start', '--hostname', process.env.SKILLHUB_HOST || '127.0.0.1', '--port', String(port)];
  await import('../node_modules/vinext/dist/cli.js');
}
