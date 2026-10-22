import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { bindSkillhubAgents, startSkillhubAgents } from '../src/runtime.js'

const skillId = 'sk-11111111-1111-4111-8111-111111111111'
const agentId = 'ag-22222222-2222-4222-8222-222222222222'
const baseUrl = 'http://10.2.14.138:3356'

test('registers presets on startup and unregisters them on dispose', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-runtime-'))
  const { fetch, calls, registrations } = mockApi({ failList: false })
  const events = []
  const ctx = context(registrations, events)
  try {
    const handle = startSkillhubAgents(ctx, {
      baseUrl,
      apiKey: 'sg_test_key',
      refreshIntervalMs: 0,
    }, { dataRoot: root, fetch })
    await handle.ready
    assert.equal(handle.registrations, 1)
    const active = registrations.filter(item => !item.released)
    assert.equal(active.length, 1)
    assert.equal(active[0].preset.id, `skillhub:${agentId}`)
    assert.equal(active[0].preset.plugins[0].config.prefix, '你是值班助手。')
    assert.equal(calls.some(call => call.url.includes('/invoke')), false)
    await handle.dispose()
    assert.equal(registrations.every(item => item.released), true)
    await assert.rejects(stat(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed refresh keeps presets already registered', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-runtime-'))
  let failList = false
  const { fetch, registrations } = mockApi({ failList: () => failList })
  const ctx = context(registrations, [])
  try {
    const handle = startSkillhubAgents(ctx, { baseUrl, apiKey: 'sg_test_key' }, { dataRoot: root, fetch })
    await handle.ready
    assert.equal(handle.registrations, 1)
    failList = true
    await handle.refresh()
    assert.equal(registrations.filter(item => !item.released).length, 1)
    await handle.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing and non-sg keys do not call fetch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-runtime-'))
  let fetches = 0
  const fetch = async () => {
    fetches += 1
    throw new Error('should not fetch')
  }
  const warnings = []
  const ctx = context([], [], warnings)
  try {
    const missing = startSkillhubAgents(ctx, { apiKey: '' }, { dataRoot: root, fetch })
    await missing.ready
    const bad = startSkillhubAgents(ctx, { apiKey: 'token-without-prefix' }, { dataRoot: join(root, 'other'), fetch })
    await bad.ready
    assert.equal(fetches, 0)
    assert.equal(warnings.length, 2)
    assert.equal(warnings.some(message => message.includes('token-without-prefix')), false)
    await missing.dispose()
    await bad.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refreshIntervalMs 0 does not poll, and dispose stops an in-flight pull', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-runtime-'))
  const intervals = []
  const timers = {
    setInterval(fn, ms) {
      intervals.push(ms)
      return { unref() {}, fn }
    },
    clearInterval() {},
  }
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { fetch, registrations } = mockApi({ gate })
  const ctx = context(registrations, [])
  try {
    const quiet = startSkillhubAgents(ctx, { apiKey: '', refreshIntervalMs: 0 }, {
      dataRoot: root,
      fetch: async () => { throw new Error('should not fetch') },
      ...timers,
    })
    await quiet.ready
    assert.deepEqual(intervals, [])
    await quiet.dispose()
    const polling = startSkillhubAgents(ctx, { apiKey: 'sg_test_key', refreshIntervalMs: 5000 }, {
      dataRoot: root,
      fetch,
      ...timers,
    })
    assert.deepEqual(intervals, [5000])
    await new Promise(resolve => setImmediate(resolve))
    const pending = polling.dispose()
    release()
    await pending
    assert.equal(registrations.filter(item => !item.released).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bindSkillhubAgents follows context dispose', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-runtime-'))
  const { fetch, registrations } = mockApi({})
  const listeners = []
  let effectDispose
  const ctx = {
    ...context(registrations, []),
    on(event, listener) {
      if (event === 'dispose') listeners.push(listener)
    },
    effect(setup) {
      effectDispose = setup()
    },
  }
  try {
    const { handle, dispose } = bindSkillhubAgents(ctx, { apiKey: 'sg_test_key' }, { dataRoot: root, fetch })
    await handle.ready
    assert.equal(listeners.length, 1)
    assert.equal(typeof effectDispose, 'function')
    listeners[0]()
    await handle.dispose()
    assert.equal(registrations.every(item => item.released), true)
    dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('package manifest is a dsh bundle and the client has no invoke route', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(manifest.name, 'dsh-skillhub-agents')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'] !== undefined, true)
  assert.equal(manifest.peerDependencies['@deepseek-ai/schemastery'] !== undefined, true)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-persona'] !== undefined, true)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-skill-filesystem'] !== undefined, true)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-agent-preset-registry'] !== undefined, true)
  assert.match(patch, /name: dsh-skillhub-agents/)
  assert.match(patch, /http:\/\/10\.2\.14\.138:3356/)
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.equal(client.includes('/invoke'), false)
})

function context(registrations, events, warnings = events) {
  return {
    logger: {
      info(message) { events.push(message) },
      warn(message) { warnings.push(message) },
      error(message) { events.push(message) },
    },
    agentPresets: {
      async register(preset) {
        const record = { preset, released: false }
        registrations.push(record)
        return async () => { record.released = true }
      },
    },
  }
}

function mockApi({ failList = false, gate } = {}) {
  const calls = []
  const registrations = []
  const agent = {
    id: agentId,
    name: '值班助手',
    description: '回答值班问题',
    config: {
      persona: '你是值班助手。',
      tools: [],
      skills: [{ skillId, version: '1.0.0' }],
      upstreamUrl: null,
    },
  }
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const parsed = new URL(url)
    if (parsed.pathname === '/api/v1/agents') {
      const failed = typeof failList === 'function' ? failList() : failList
      if (failed) return new Response('nope', { status: 500 })
      return json({ data: { items: [{ id: agentId }], total: 1, offset: 0, limit: 100, nextOffset: null } })
    }
    if (parsed.pathname === `/api/v1/agents/${agentId}`) {
      if (gate) await gate
      return json({ data: agent })
    }
    if (parsed.pathname === `/api/v1/skills/${skillId}/file`) {
      return new Response('---\nname: duty\ndescription: Duty skill\n---\n\n# Duty\n', { status: 200 })
    }
    return new Response('missing', { status: 404 })
  }
  return { fetch, calls, registrations }
}

function json(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
}
