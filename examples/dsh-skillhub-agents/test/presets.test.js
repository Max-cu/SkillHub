import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { normalizeConfig } from '../src/config.js'
import { loadPresets } from '../src/load.js'
import { HARNESS_PACKAGES } from '../src/packages.js'
import { prepareSkillMarkdown } from '../src/skills.js'

const skillId = 'sk-11111111-1111-4111-8111-111111111111'
const missingSkillId = 'sk-33333333-3333-4333-8333-333333333333'
const agentId = 'ag-22222222-2222-4222-8222-222222222222'

test('prepareSkillMarkdown keeps frontmatter and wraps a bare body', () => {
  const sourced = '---\nname: duty\ndescription: Duty skill\n---\n\n# Duty\n'
  assert.equal(prepareSkillMarkdown(sourced, skillId), sourced)
  const wrapped = prepareSkillMarkdown('# Notes\n', skillId)
  assert.match(wrapped, new RegExp(`^---\\nname: ${skillId}\\ndescription: SkillHub skill\\n---\\n`))
  assert.match(wrapped, /# Notes/)
})

test('loadPresets maps agents to persona and skill-filesystem rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhub-agents-'))
  const markdown = '---\nname: duty\ndescription: Duty skill\n---\n\n# Duty\n'
  const calls = []
  const client = {
    async listAgents() {
      calls.push('list')
      return [{ id: agentId }, { id: 'ag-44444444-4444-4444-8444-444444444444' }, { id: '../escape' }]
    },
    async getAgent(id) {
      calls.push(`agent:${id}`)
      if (id !== agentId) {
        const error = new Error('SkillHub responded 404 for /api/v1/agents/' + id)
        error.status = 404
        throw error
      }
      return {
        id: agentId,
        name: '值班助手',
        description: '回答值班问题',
        config: {
          persona: '你是值班助手。',
          tools: ['search'],
          skills: [
            { skillId, version: '1.0.0' },
            { skillId: missingSkillId },
            { skillId: 'sk-55555555-5555-4555-8555-555555555555', version: 'latest' },
          ],
          upstreamUrl: 'http://10.9.9.9/should-not-be-called',
        },
      }
    },
    async getSkillMarkdown(id, version) {
      calls.push(`skill:${id}:${version ?? ''}`)
      if (id === missingSkillId) throw new Error('SkillHub responded 404 for /api/v1/skills/' + id + '/file')
      assert.equal(version, '1.0.0')
      return markdown
    },
  }
  try {
    const config = normalizeConfig({ personaPackage: '@chem/persona', skillFilesystemPackage: 'not a package' })
    const { presets, failures } = await loadPresets(client, config, root)
    assert.equal(presets.length, 1)
    assert.equal(presets[0].id, `skillhub:${agentId}`)
    assert.equal(presets[0].name, '值班助手')
    assert.equal(presets[0].description, '回答值班问题')
    assert.deepEqual(presets[0].plugins[0], {
      id: 'persona',
      name: '@chem/persona',
      config: { prefix: '你是值班助手。' },
    })
    const filesystem = presets[0].plugins[1]
    assert.equal(filesystem.id, 'skill-filesystem')
    assert.equal(filesystem.name, HARNESS_PACKAGES.skillFilesystem)
    assert.equal(filesystem.config.providerName, 'skillhub')
    const written = await readFile(join(filesystem.config.customSkillDirs[0], `${skillId}-1.0.0`, 'SKILL.md'), 'utf8')
    assert.equal(written, markdown)
    assert.equal(calls.some(call => call.startsWith('skill:' + missingSkillId)), true)
    assert.equal(calls.some(call => call.includes('latest')), false)
    assert.equal(calls.some(call => call.includes('10.9.9.9')), false)
    assert.equal(failures.some(failure => failure.skillId === missingSkillId), true)
    assert.equal(presets[0].plugins.some(plugin => JSON.stringify(plugin).includes('invoke')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
