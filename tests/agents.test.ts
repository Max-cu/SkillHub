import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPagination, agentReceipt, defaultAgentSlug, mapAgent, mergeAgentConfig, validateAgentCreate, validateAgentPatch, validateInvoke } from '../lib/agents.ts';
import { openapi } from '../lib/openapi.ts';

const config = { persona: '你是值班助手。', tools: ['search'], upstreamUrl: 'https://example.internal/v1' };

test('agent create accepts a minimal draft and derives nothing until the server asks', () => {
  const created = validateAgentCreate({ name: '  值班助手  ' });
  assert.equal(created.name, '值班助手');
  assert.equal(created.slug, null);
  assert.equal(created.description, '');
  assert.equal(created.status, 'draft');
  assert.deepEqual(created.config, { persona: '', tools: [], upstreamUrl: null });
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

test('openapi lists owner-private agent routes separately from skill agent tags', () => {
  for (const path of ['/agents', '/agents/{id}', '/agents/{id}/invoke']) assert.ok(openapi.paths[path as keyof typeof openapi.paths], path);
  assert.equal(openapi.paths['/agents/{id}/invoke'].post.summary.includes('No harness'), true);
  assert.equal(JSON.stringify(openapi.paths['/skills']).includes('skills.agents'), false);
  const listed = Object.keys(openapi.paths);
  assert.equal(listed.filter(path => path.startsWith('/agents')).length, 3);
});
