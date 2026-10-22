import { DEFAULT_BASE_URL, HARNESS_PACKAGES } from './packages.js'

const PACKAGE_NAME = /^@[a-z0-9][a-z0-9-._]*\/[a-z0-9][a-z0-9-._]*$/

/**
 * Normalize plugin config. The Cordis schema in the package entry applies the
 * same defaults when the harness loads the bundle.
 */
export function normalizeConfig(config = {}) {
  const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.trim()
    ? config.baseUrl.trim()
    : DEFAULT_BASE_URL
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  const refresh = Number(config.refreshIntervalMs ?? 0)
  return {
    baseUrl,
    apiKey,
    refreshIntervalMs: Number.isFinite(refresh) && refresh > 0 ? refresh : 0,
    personaPackage: packageName(config.personaPackage, HARNESS_PACKAGES.persona),
    skillFilesystemPackage: packageName(config.skillFilesystemPackage, HARNESS_PACKAGES.skillFilesystem),
  }
}

export function apiKeyProblem(apiKey) {
  if (!apiKey) return '未配置 API Key'
  if (!apiKey.startsWith('sg_') || apiKey.length <= 3) return 'API Key 须以 sg_ 开头'
  return ''
}

function packageName(value, fallback) {
  if (typeof value !== 'string') return fallback
  const name = value.trim()
  return PACKAGE_NAME.test(name) ? name : fallback
}
