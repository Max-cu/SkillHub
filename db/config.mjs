export function postgresConfig(value = process.env.SKILLHUB_DATABASE_URL) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Set a valid SKILLHUB_DATABASE_URL for the dedicated SkillHub database.'); }
  const database = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || 5432);
  // Never fall back to DATABASE_URL, PG* variables, or a SkillGo service alias.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || database !== 'skillhub' || user !== 'skillhub_app' || !url.password || url.search || url.hash) {
    throw new Error('SkillHub requires database=skillhub, user=skillhub_app and its own password; URL overrides are not allowed.');
  }
  if (!((host === 'skillhub-postgres' && port === 5432) || (['127.0.0.1', 'localhost', '::1'].includes(host) && port === 5433))) {
    throw new Error('SkillHub only connects to skillhub-postgres:5432, or a dedicated local instance on port 5433.');
  }
  return { host, port, database, user, password: decodeURIComponent(url.password), application_name: 'skillhub', max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 };
}
