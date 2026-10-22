import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '../src/client.js'
import { resolveApiUrl } from '../src/url.js'

const baseUrl = 'http://10.2.14.138:3356'

test('resolveApiUrl joins the API path and rejects non-HTTP bases', () => {
  assert.equal(
    resolveApiUrl(`${baseUrl}/`, '/api/v1/agents?scope=mine&offset=0&limit=100'),
    `${baseUrl}/api/v1/agents?scope=mine&offset=0&limit=100`,
  )
  assert.equal(
    resolveApiUrl(`${baseUrl}/hub`, 'api/v1/agents'),
    `${baseUrl}/hub/api/v1/agents`,
  )
  assert.throws(() => resolveApiUrl('file:///tmp/skillhub', '/api/v1/agents'), /http/)
})

test('lists every page, then reads one agent and its skill file', async () => {
  const calls = []
  const skillId = 'sk-11111111-1111-4111-8111-111111111111'
  const agent = agentRecord('ag-22222222-2222-4222-8222-222222222222', [{ skillId, version: '1.0.0' }])
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const parsed = new URL(url)
    if (parsed.pathname === '/api/v1/agents' && parsed.searchParams.get('offset') === '0') {
      return json({ data: { items: [{ id: agent.id }], total: 2, offset: 0, limit: 100, nextOffset: 1 } })
    }
    if (parsed.pathname === '/api/v1/agents' && parsed.searchParams.get('offset') === '1') {
      return json({ data: { items: [{ id: 'ag-33333333-3333-4333-8333-333333333333' }], total: 2, offset: 1, limit: 100, nextOffset: null } })
    }
    if (parsed.pathname === `/api/v1/agents/${agent.id}`) return json({ data: agent })
    if (parsed.pathname === '/api/v1/skills/' + skillId + '/file') {
      if (parsed.searchParams.has('version')) {
        assert.equal(parsed.searchParams.get('version'), '1.0.0')
        return text('---\nname: duty\ndescription: Duty skill\n---\n\n# Duty\n')
      }
      return text('# Bare\n')
    }
    return text('missing', 404)
  }
  const client = createClient({ baseUrl, apiKey: 'sg_test_key', fetch })
  const items = await client.listAgents()
  assert.deepEqual(items.map(item => item.id), [agent.id, 'ag-33333333-3333-4333-8333-333333333333'])
  const detail = await client.getAgent(agent.id)
  assert.equal(detail.config.persona, '你是值班助手。')
  const markdown = await client.getSkillMarkdown(skillId, '1.0.0')
  assert.match(markdown, /# Duty/)
  const bare = await client.getSkillMarkdown(skillId)
  assert.equal(calls.at(-1).url.includes('version='), false)
  assert.equal(bare, '# Bare\n')
  for (const call of calls) {
    assert.equal(call.url.includes('/invoke'), false)
    assert.equal(call.init.method, 'GET')
    assert.equal(call.init.headers.Authorization, 'Bearer sg_test_key')
    assert.equal(call.init.redirect, 'error')
  }
  assert.equal(calls.some(call => call.url.includes(agent.config.upstreamUrl)), false)
})

function agentRecord(id, skills) {
  return {
    id,
    slug: 'duty',
    name: '值班助手',
    description: '回答值班问题',
    owner: 'user-1',
    status: 'published',
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    config: {
      persona: '你是值班助手。',
      tools: ['search'],
      skills,
      upstreamUrl: 'http://10.9.9.9/should-not-be-called',
    },
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/markdown' } })
}
