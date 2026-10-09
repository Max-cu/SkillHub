/** Exact origins are configured by the operator; request headers cannot enable a workspace. */
export function workspaceMode(url: URL, configuredOrigins = ''): 'local' | 'shared' | null {
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return 'local';
  return configuredOrigins.split(',').map(value => value.trim()).filter(Boolean).includes(url.origin) ? 'shared' : null;
}
