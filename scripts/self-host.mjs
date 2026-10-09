import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './sites-env.mjs';

const mode = process.argv[2];
if (!['serve', 'migrate'].includes(mode)) throw new Error('Expected serve or migrate.');
const port = Number(process.env.SKILLHUB_PORT || 3356);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SKILLHUB_PORT.');
const configuredOrigins = (process.env.SKILLHUB_WORKSPACE_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
for (const origin of configuredOrigins) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('Workspace origins must be exact http(s) origins, without a trailing slash.');
}
const config = JSON.parse(readFileSync(path.join(projectRoot, 'dist/server/wrangler.json'), 'utf8'));
config.main = path.resolve(projectRoot, 'dist/server', config.main);
config.assets = { ...config.assets, directory: path.resolve(projectRoot, 'dist/server', config.assets.directory) };
config.vars = { ...config.vars, SKILLHUB_WORKSPACE_ORIGINS: configuredOrigins.join(',') };
config.d1_databases = config.d1_databases.map(binding => ({ ...binding, migrations_dir: path.join(projectRoot, 'drizzle') }));
const configPath = path.join(projectRoot, '.sites-runtime/self-host.json');
const statePath = path.resolve(process.env.SKILLHUB_DATA_DIR || path.join(projectRoot, '.wrangler/state'));
mkdirSync(path.dirname(configPath), { recursive: true });
mkdirSync(statePath, { recursive: true });
writeFileSync(configPath, JSON.stringify(config));
if (mode === 'migrate') {
  const args = ['d1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', statePath];
  const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'), ...args], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  // Run the compiled Worker directly, without Wrangler's HMR/retry proxy.
  const { Miniflare } = await import('miniflare');
  const modulePaths = readdirSync(path.dirname(config.main), { recursive: true })
    .filter(name => /\.(m?js)$/.test(name))
    .map(name => path.join(path.dirname(config.main), name))
    .filter(name => name !== config.main);
  const runtime = new Miniflare({
    name: config.name,
    host: process.env.SKILLHUB_HOST || '127.0.0.1',
    port,
    cf: false,
    // Vinext uses dynamic imports: register every emitted module explicitly.
    modules: [config.main, ...modulePaths].map(modulePath => ({ type: 'ESModule', path: modulePath })),
    rootPath: path.dirname(config.main),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    bindings: config.vars,
    d1Databases: Object.fromEntries(config.d1_databases.map(binding => [binding.binding, binding.database_id])),
    d1Persist: path.join(statePath, 'v3/d1'),
    assets: { directory: config.assets.directory, routerConfig: { has_user_worker: true } },
  });
  const address = await runtime.ready;
  console.log(`SkillHub ready on ${address}; persistent data: ${statePath}`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await runtime.dispose();
    process.exit(0);
  });
}
