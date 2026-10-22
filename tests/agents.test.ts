import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPagination, agentReceipt, authorizeAgentSkillWrites, defaultAgentSlug, mapAgent, mergeAgentConfig, resolveSkillSnapshots, validateAgentCreate, validateAgentPatch, validateInvoke, type ReadableSkillVersion, type SkillAccess } from '../lib/agents.ts';
import { ApiError } from '../lib/domain.ts';
import { openapi } from '../lib/openapi.ts';

const skillA = 'sk-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const skillB = 'sk-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const config = { persona: '你是值班助手。', tools: ['search'], skills: [] as {skillId:string;version?:string}[], upstreamUrl: 'https://example.internal/v1' };
const readable = (id: string, version = '1.0.0', owner = 'me', communityBlocked = false): ReadableSkillVersion => ({ skillId: id, version, name: '值班笔记', digest: 'sha256:abc', markdown: '# 值班\n' + '正文'.repeat(1200), owner, communityBlocked });

test('agent create accepts a minimal draft and derives nothing until the server asks', () => {
  const created = validateAgentCreate({ name: '  值班助手  ' });
  assert.equal(created.name, '值班助手');
  assert.equal(created.slug, null);
  assert.equal(created.description, '');
  assert.equal(created.status, 'draft');
  assert.deepEqual(created.config, { persona: '', tools: [], skills: [], upstreamUrl: null });
  assert.equal(defaultAgentSlug('值班助手').startsWith('agent-'), true);
  assert.equal(defaultAgentSlug('Duty Assistant'), 'duty-assistant');
});

test('agent config keeps persona, tool scope and an optional http(s) upstream', () => {
  const created = validateAgentCreate({ name: 'Duty', slug: 'duty-assistant', description: '回答值班问题', status: 'published', config });
  assert.equal(created.slug, 'duty-assistant');
  assert.equal(created.status, 'published');
  assert.deepEqual(created.config.tools, ['search']);
  assert.deepEqual(mergeAgentConfig(created.config, { tools: ['search', 'notes'] }).tools, ['search', 'notes']);
  assert.equal(mergeAgentConfig(created.config, { upstreamUrl: null }).upstreamUrl, null);
  assert.equal(mergeAgentConfig(created.config, { persona: '新的人设' }).upstreamUrl, config.upstreamUrl);
});

test('agent writes reject unsafe or oversized fields', () => {
  for (const input of [
    {},
    { name: '' },
    { name: 'a'.repeat(121) },
    { name: 'Duty', slug: 'Duty' },
    { name: 'Duty', slug: 'bad slug' },
    { name: 'Duty', status: 'archived' },
    { name: 'Duty', config: [] },
    { name: 'Duty', config: { tools: ['ok', ''] } },
    { name: 'Duty', config: { tools: Array.from({ length: 21 }, (_, i) => 't'+i) } },
    { name: 'Duty', config: { upstreamUrl: 'javascript:alert(1)' } },
    { name: 'Duty', config: { upstreamUrl: 'ftp://files.example/a' } },
    { name: 'Duty', description: 'a'.repeat(4001) },
  ]) assert.throws(() => validateAgentCreate(input as Record<string, unknown>));
  assert.throws(() => validateAgentPatch({}));
  assert.deepEqual(validateAgentPatch({ description: '' }).description, '');
  assert.deepEqual(validateAgentCreate({ name: 'Duty', config: { tools: [' search ', 'search'] } }).config.tools, ['search']);
});

test('invoke echoes input and context without executing them', () => {
  const agent = mapAgent({
    id: 'ag-1', slug: 'duty-assistant', name: '值班助手', description: '说明', owner: 'cas-user',
    config: JSON.stringify(config), status: 'published', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z',
  });
  const invoke = validateInvoke({ input: '  今天有哪些待办？  ', context: { locale: 'zh-CN', n: 0 } });
  const receipt = agentReceipt(agent, invoke, '2026-10-22T01:02:03.000Z', 'receipt-1');
  assert.deepEqual(receipt, {
    receiptId: 'receipt-1', status: 'accepted', timestamp: '2026-10-22T01:02:03.000Z', input: '今天有哪些待办？', context: { locale: 'zh-CN', n: 0 },
    skillsResolved: [],
    agent: { id: 'ag-1', name: '值班助手', slug: 'duty-assistant', status: 'published', config },
  });
  assert.equal(validateInvoke({ input: 'hello' }).context, undefined);
  assert.equal(agentReceipt(agent, validateInvoke({ input: 'hello', context: null }), '2026-10-22T01:02:03.000Z', 'receipt-2').context, null);
  for (const input of [{}, { input: '   ' }, { input: 'a'.repeat(20001) }, { input: 'ok', context: 'x'.repeat(100_001) }]) assert.throws(() => validateInvoke(input));
  assert.throws(() => mapAgent({ ...{
    id: 'ag-1', slug: 'duty-assistant', name: '值班助手', description: '', owner: 'cas-user',
    config: '{', status: 'draft', createdAt: 't', updatedAt: 't',
  } }));
});

test('agent pagination matches the skills list bounds', () => {
  assert.deepEqual(agentPagination(new URLSearchParams()), { offset: 0, limit: 24 });
  assert.deepEqual(agentPagination(new URLSearchParams('offset=24&limit=100')), { offset: 24, limit: 100 });
  for (const query of ['offset=-1', 'limit=0', 'limit=101', 'offset=1.5']) assert.throws(() => agentPagination(new URLSearchParams(query)));
});

function apiError(status: number, code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}
function row(configJson: unknown, status = 'draft') {
  return {
    id: 'ag-1', slug: 'duty-assistant', name: '值班助手', description: '', owner: 'cas-user',
    config: JSON.stringify(configJson), status, createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z',
  };
}

test('skill refs dedupe by skillId and merge without dropping other fields', () => {
  const created = validateAgentCreate({ name: 'Duty', status: 'published', config: { skills: [
    { skillId: skillA, version: '1.0.0' },
    { skillId: skillA, version: '1.2.0' },
    { skillId: skillB },
    { skillId: skillA },
  ] } });
  assert.deepEqual(created.config.skills, [{ skillId: skillA }, { skillId: skillB }]);
  assert.equal(created.status, 'published');
  const merged = mergeAgentConfig(created.config, { tools: ['search'] });
  assert.deepEqual(merged.skills, created.config.skills);
  assert.deepEqual(merged.tools, ['search']);
  assert.deepEqual(mergeAgentConfig(created.config, { skills: [{ skillId: skillB, version: '2.0.0' }] }).skills, [{ skillId: skillB, version: '2.0.0' }]);
  assert.deepEqual(mergeAgentConfig(created.config, { persona: '只改人设' }).upstreamUrl, null);
  assert.throws(() => validateAgentCreate({ name: 'Duty', config: { skills: [{ skillId: 'notes' }] } }), apiError(400, 'invalid_skill'));
  assert.throws(() => validateAgentCreate({ name: 'Duty', config: { skills: [{ slug: 'notes' }] } }), apiError(400, 'invalid_skill'));
  assert.throws(() => validateAgentCreate({ name: 'Duty', config: { skills: Array.from({ length: 21 }, () => ({ skillId: skillA })) } }), apiError(400, 'invalid_skill'));
  assert.throws(() => validateAgentCreate({ name: 'Duty', config: { skills: [{ skillId: skillA, version: '1.0' }] } }), apiError(400, 'invalid_version'));
});

test('old agents without skills still round-trip', () => {
  const legacy = mapAgent(row({ persona: '旧人设', tools: ['search'], upstreamUrl: null }));
  assert.deepEqual(legacy.config.skills, []);
  assert.equal(legacy.config.persona, '旧人设');
  const again = mapAgent(row(legacy.config));
  assert.deepEqual(again.config, legacy.config);
  const pinned = mapAgent(row({ persona: '', tools: [], skills: [{ skillId: skillA, version: '1.2.0' }], upstreamUrl: null }));
  assert.deepEqual(pinned.config.skills, [{ skillId: skillA, version: '1.2.0' }]);
  assert.deepEqual(mapAgent(row(pinned.config)).config.skills, pinned.config.skills);
});

test('skill writes reject inaccessible refs and do not treat published as access', async () => {
  const calls: Array<string | undefined> = [];
  const hidden: SkillAccess = {
    resolveSlug: async () => { throw new Error('slug lookup'); },
    read: async (_userId, _skillId, version) => { calls.push(version); return null; },
  };
  const input = { name: 'Duty', status: 'published', config: { skills: [{ skillId: skillA, version: '1.0.0' }] } };
  await assert.rejects(() => authorizeAgentSkillWrites('me', input, hidden), apiError(404, 'skill_not_found'));
  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(input.config.skills, [{ skillId: skillA, version: '1.0.0' }]);
  let reads = 0;
  await assert.rejects(() => authorizeAgentSkillWrites('me', { name: 'Duty', config: { skills: [{ skillId: 'other-private' }] } }, { resolveSlug: async () => null, read: async () => { reads += 1; return null; } }), apiError(400, 'invalid_skill'));
  assert.equal(reads, 0);
  const unchanged = { name: 'Duty', config: { persona: '保持' } };
  assert.equal(await authorizeAgentSkillWrites('me', unchanged, hidden), unchanged);
});

test('pinned unavailable versions are rejected only after the skill itself is readable', async () => {
  const calls: Array<string | undefined> = [];
  const access: SkillAccess = {
    resolveSlug: async () => { throw new Error('slug lookup'); },
    read: async (_userId, id, version) => {
      calls.push(version);
      if (version) return null;
      return readable(id);
    },
  };
  await assert.rejects(() => authorizeAgentSkillWrites('me', { name: 'Duty', config: { skills: [{ skillId: skillA, version: '9.9.9' }] } }, access), apiError(400, 'skill_version_unavailable'));
  assert.deepEqual(calls, [undefined, '9.9.9']);
  const blocked: SkillAccess = {
    resolveSlug: async () => skillA,
    read: async (_userId, id) => readable(id, '1.0.0', 'someone-else', true),
  };
  await assert.rejects(() => authorizeAgentSkillWrites('me', { name: 'Duty', status: 'published', config: { skills: [{ slug: 'notes', version: '1.0.0' }] } }, blocked), apiError(404, 'skill_not_found'));
  const ownerBlocked = await authorizeAgentSkillWrites('owner', { name: 'Duty', config: { skills: [{ skillId: skillA }] } }, {
    resolveSlug: async () => { throw new Error('slug lookup'); },
    read: async (_userId, id) => readable(id, '3.0.0', 'owner', true),
  });
  assert.deepEqual((ownerBlocked.config as {skills:{skillId:string}[]}).skills, [{ skillId: skillA }]);
});

test('slug writes resolve to skillId and later refs win', async () => {
  const prepared = await authorizeAgentSkillWrites('me', { name: 'Duty', config: { persona: 'p', skills: [
    { slug: 'notes', version: '1.0.0' },
    { skillId: skillA, version: '2.0.0' },
    { skillId: skillB },
  ] } }, {
    resolveSlug: async (userId, slug) => { assert.equal(userId, 'me'); assert.equal(slug, 'notes'); return skillA; },
    read: async (_userId, id, version) => readable(id, version ?? '2.0.0'),
  });
  assert.deepEqual((prepared.config as {skills:unknown}).skills, [{ skillId: skillA, version: '2.0.0' }, { skillId: skillB }]);
  assert.equal(JSON.stringify(prepared.config).includes('notes'), false);
  await assert.rejects(() => authorizeAgentSkillWrites('me', { config: { skills: [{ slug: 'shared' }] } }, {
    resolveSlug: async () => 'ambiguous',
    read: async () => { throw new Error('read'); },
  }), apiError(400, 'ambiguous_skill'));
  await assert.rejects(() => authorizeAgentSkillWrites('me', { config: { skills: [{ slug: 'missing' }] } }, {
    resolveSlug: async () => null,
    read: async () => { throw new Error('read'); },
  }), apiError(404, 'skill_not_found'));
});

test('invoke stays an acceptance receipt and does not call the network', async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => { calls.push(String(input)); throw new Error('network'); }) as typeof fetch;
  try {
    const agent = mapAgent(row({ ...config, skills: [{ skillId: skillA }, { skillId: skillB, version: '9.9.9' }], upstreamUrl: 'http://127.0.0.1:9/nope' }, 'published'));
    const snapshots = await resolveSkillSnapshots(agent.owner, agent.config.skills, {
      read: async (_userId, id, version) => version ? null : readable(id, '1.4.0', agent.owner),
    });
    const receipt = agentReceipt(agent, validateInvoke({ input: '  hello  ' }), '2026-10-22T01:02:03.000Z', 'receipt-3', snapshots);
    assert.equal(receipt.status, 'accepted');
    assert.equal('output' in receipt, false);
    assert.equal(receipt.agent.config.upstreamUrl, 'http://127.0.0.1:9/nope');
    assert.equal(receipt.skillsResolved[0].resolved, true);
    assert.equal(receipt.skillsResolved[0].version, '1.4.0');
    assert.equal(receipt.skillsResolved[0].name, '值班笔记');
    assert.equal(receipt.skillsResolved[0].markdown?.length, 2000);
    assert.deepEqual(receipt.skillsResolved[1], { skillId: skillB, version: '9.9.9', resolved: false });
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('openapi lists owner-private agent routes separately from skill agent tags', () => {
  for (const path of ['/agents', '/agents/{id}', '/agents/{id}/invoke']) assert.ok(openapi.paths[path as keyof typeof openapi.paths], path);
  assert.equal(openapi.paths['/agents/{id}/invoke'].post.summary.includes('No harness'), true);
  assert.equal(openapi.paths['/agents/{id}/invoke'].post.summary.includes('upstream HTTP'), true);
  const configSkills = (operation: { requestBody?: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } } }) => ((operation.requestBody!.content['application/json'].schema.properties.config as { properties: { skills: { maxItems: number; items: { properties: { skillId: { pattern: string } } } } } }).properties.skills);
  const postSkills = configSkills(openapi.paths['/agents'].post);
  const patchSkills = configSkills(openapi.paths['/agents/{id}'].patch);
  assert.equal(postSkills.maxItems, 20);
  assert.equal(postSkills.items.properties.skillId.pattern, '^sk-[a-f0-9-]{36}$');
  assert.equal(patchSkills.maxItems, 20);
  assert.equal(JSON.stringify(openapi.paths['/skills']).includes('skills.agents'), false);
  const listed = Object.keys(openapi.paths);
  assert.equal(listed.filter(path => path.startsWith('/agents')).length, 3);
});
