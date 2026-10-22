/** Join a SkillHub base URL with an API path. Rejects non-HTTP bases. */
export function resolveApiUrl(baseUrl, pathAndQuery) {
  let base
  try {
    base = new URL(baseUrl)
  } catch {
    throw new TypeError('SkillHub baseUrl is not a URL')
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new TypeError('SkillHub baseUrl must be http(s)')
  }
  if (!base.host) throw new TypeError('SkillHub baseUrl is missing a host')
  const [path, query = ''] = String(pathAndQuery).split('?')
  const prefix = base.pathname.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  const url = new URL(prefix + suffix, base.origin)
  if (query) url.search = query
  return url.toString()
}
