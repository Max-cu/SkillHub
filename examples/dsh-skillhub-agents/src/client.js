import { resolveApiUrl } from './url.js'

const PAGE_LIMIT = 100
const MAX_PAGES = 100

/**
 * SkillHub HTTP client for the desktop agent list.
 * Reads agents and skill markdown only. It has no invoke method.
 */
export function createClient({ baseUrl, apiKey, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required')

  async function send(pathAndQuery, accept) {
    const url = resolveApiUrl(baseUrl, pathAndQuery)
    let response
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: accept,
        },
      })
    } catch (error) {
      throw new SkillHubError(`SkillHub request failed for ${pathnameOf(url)}`, 0, { cause: error })
    }
    if (!response.ok) {
      throw new SkillHubError(`SkillHub responded ${response.status} for ${pathnameOf(url)}`, response.status)
    }
    return { response, url }
  }

  return {
    async listAgents() {
      const items = []
      let offset = 0
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const path = `/api/v1/agents?scope=mine&offset=${offset}&limit=${PAGE_LIMIT}`
        const { response, url } = await send(path, 'application/json')
        const body = await readJson(response, url)
        const data = body?.data
        if (!data || !Array.isArray(data.items)) {
          throw new SkillHubError('SkillHub agent list is missing data.items', response.status)
        }
        items.push(...data.items)
        if (data.nextOffset == null) return items
        if (typeof data.nextOffset !== 'number' || data.nextOffset <= offset) {
          throw new SkillHubError('SkillHub agent list nextOffset did not advance', response.status)
        }
        offset = data.nextOffset
      }
      throw new SkillHubError('SkillHub agent list exceeded 100 pages', 200)
    },

    async getAgent(id) {
      const { response, url } = await send(`/api/v1/agents/${encodeURIComponent(id)}`, 'application/json')
      const body = await readJson(response, url)
      if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        throw new SkillHubError('SkillHub agent detail is missing data', response.status)
      }
      return body.data
    },

    async getSkillMarkdown(skillId, version) {
      const query = typeof version === 'string' && version ? `?version=${encodeURIComponent(version)}` : ''
      const { response } = await send(`/api/v1/skills/${encodeURIComponent(skillId)}/file${query}`, 'text/markdown, text/plain;q=0.9, */*;q=0.8')
      return response.text()
    },
  }
}

export class SkillHubError extends Error {
  constructor(message, status = 0, options) {
    super(message, options)
    this.name = 'SkillHubError'
    this.status = status
  }
}

async function readJson(response, url) {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new SkillHubError(`SkillHub returned non-JSON for ${pathnameOf(url)}`, response.status)
  }
}

function pathnameOf(url) {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
