/**
 * The canonical callback is server configuration, never Host or forwarded headers.
 * @param {Record<string, string | undefined>} env
 */
export function readAuthConfig(env = process.env) {
  const mode = env.SKILLHUB_AUTH_MODE || 'cas';
  if (!['cas', 'local'].includes(mode)) throw new Error('Invalid SkillHub authentication mode.');
  if (mode === 'local') {
    if (env.NODE_ENV === 'production') throw new Error('Local identity is disabled in production.');
    return { mode, service: '', base: '', ttl: 28800, secure: false };
  }
  if (!env.SKILLHUB_CAS_SERVICE) throw new Error('SKILLHUB_CAS_SERVICE is required.');
  const service = new URL(env.SKILLHUB_CAS_SERVICE);
  if (!['http:', 'https:'].includes(service.protocol) || service.username || service.password || service.search || service.hash || service.pathname !== '/' || service.href !== env.SKILLHUB_CAS_SERVICE) throw new Error('CAS service must be one exact canonical root URL ending in /.');
  const base = new URL(env.SKILLHUB_CAS_BASE_URL || 'https://cas.china-tcc.com/cas');
  const mock = env.NODE_ENV === 'test' && env.SKILLHUB_AUTH_TEST_MODE === 'isolated' && base.protocol === 'http:' && base.hostname === 'cas-mock';
  if ((!mock && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || base.pathname !== '/cas') throw new Error('CAS must use an HTTPS /cas endpoint.');
  const ttl = Number(env.SKILLHUB_CAS_SESSION_TTL_SECONDS || 28800);
  if (!Number.isInteger(ttl) || ttl < 300 || ttl > 86400) throw new Error('CAS session TTL must be 300–86400 seconds.');
  return { mode, service: service.href, base: base.href.replace(/\/$/, ''), ttl, secure: service.protocol === 'https:' };
}
