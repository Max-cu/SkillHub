import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mapAgent, validateInvoke, type AgentSkillSnapshot } from '../lib/agents.ts';
import { nodeUpstreamRequest, performAgentInvoke, upstreamPayload, upstreamTimeoutMs, type UpstreamHop, type UpstreamRequest } from '../lib/agents-invoke.ts';
import { classifyAddress, parseAllowlist, vetUpstream, type DnsLookup } from '../lib/agents-ssrf.ts';

const skillA = 'sk-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const skillB = 'sk-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stamp = '2026-10-22T01:02:03.000Z';
const snapshots: AgentSkillSnapshot[] = [
  { skillId: skillA, version: '1.4.0', name: '值班笔记', digest: 'sha256:abc', markdown: '# 值班', resolved: true },
  { skillId: skillB, version: '9.9.9', resolved: false },
];

function agent(upstreamUrl: string | null) {
  return mapAgent({
    id: 'ag-1', slug: 'duty-assistant', name: '值班助手', description: '', owner: 'cas-user',
    config: JSON.stringify({ persona: '你是值班助手。', tools: ['search'], skills: [{ skillId: skillA }], upstreamUrl }),
    status: 'published', createdAt: stamp, updatedAt: stamp,
  });
}
const invoke = validateInvoke({ input: '  今天有哪些待办？  ', context: { locale: 'zh-CN' } });

function probe() {
  const looked: string[] = [];
  const requested: UpstreamHop[] = [];
  const lookup: DnsLookup = async host => { looked.push(host); throw new Error('dns'); };
  const request: UpstreamRequest = async hop => { requested.push(hop); throw new Error('request'); };
  return { looked, requested, lookup, request };
}
function env(allowlist?: string, extra: { AGENTHUB_INVOKE_PROXY?: string } = {}) {
  return allowlist === undefined ? extra : { ...extra, AGENTHUB_UPSTREAM_ALLOWLIST: allowlist };
}

test('classifyAddress denies loopback, link-local and metadata, and marks RFC1918 private', () => {
  for (const ip of ['127.0.0.1', '0.0.0.0', '169.254.169.254', '169.254.170.2', '100.100.100.200', '::1', '::', 'fe80::1', 'fd00:ec2::254', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '224.0.0.1', '255.255.255.255']) {
    assert.equal(classifyAddress(ip), 'deny', ip);
  }
  for (const ip of ['10.2.14.20', '172.16.0.1', '192.168.1.9', '100.64.0.1', 'fd12::1', '::ffff:a02:e14']) assert.equal(classifyAddress(ip), 'private', ip);
  assert.equal(classifyAddress('1.2.3.4'), 'public');
  assert.equal(classifyAddress('not-an-ip'), 'invalid');
});

test('allowlist parses hosts, declared ports and CIDR, and ignores open or malformed entries', () => {
  const allow = parseAllowlist(' CHEM.BUDDY.TEST:8443, chem.buddy.test , 10.2.14.0/24, fc00::/7, 0.0.0.0/0, *, https://evil.example, user@host ');
  assert.equal(allow.hosts.has('chem.buddy.test'), true);
  assert.equal(allow.hosts.get('chem.buddy.test')?.has(8443), true);
  assert.equal(allow.cidrCount, 2);
  assert.equal(parseAllowlist(' , , ').hosts.size, 0);
  assert.equal(parseAllowlist(undefined).cidrCount, 0);
  assert.equal(upstreamTimeoutMs({}), 60_000);
  assert.equal(upstreamTimeoutMs({ AGENTHUB_UPSTREAM_TIMEOUT_MS: '1500' }), 1500);
  assert.equal(upstreamTimeoutMs({ AGENTHUB_UPSTREAM_TIMEOUT_MS: '10' }), 60_000);
});

test('empty upstreamUrl stays an acceptance receipt and does not resolve or connect', async () => {
  const gate = probe();
  const receipt = await performAgentInvoke(agent(null), invoke, snapshots, { env: env('chem.buddy.test'), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-empty' });
  assert.equal(receipt.status, 'accepted');
  assert.equal(receipt.receiptId, 'receipt-empty');
  assert.equal('output' in receipt, false);
  assert.equal('error' in receipt, false);
  assert.equal(receipt.skillsResolved[1].resolved, false);
  assert.equal(gate.looked.length, 0);
  assert.equal(gate.requested.length, 0);
});

test('kill switch forces a receipt even when the upstream would be allowlisted', async () => {
  const gate = probe();
  const receipt = await performAgentInvoke(agent('http://169.254.169.254/latest'), invoke, snapshots, {
    env: env('169.254.169.254', { AGENTHUB_INVOKE_PROXY: '0' }), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-off',
  });
  assert.equal(receipt.status, 'accepted');
  assert.equal(gate.looked.length, 0);
  assert.equal(gate.requested.length, 0);
});

test('missing allowlist rejects the call before DNS or HTTP', async () => {
  for (const allow of [undefined, '', ' , ']) {
    const gate = probe();
    const receipt = await performAgentInvoke(agent('http://chem.buddy.test/v1'), invoke, snapshots, { env: env(allow), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-none' });
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.error?.code, 'upstream_not_allowed');
    assert.match(receipt.error?.message ?? '', /允许名单/);
    assert.equal(gate.looked.length, 0);
    assert.equal(gate.requested.length, 0);
  }
});

test('a host outside the allowlist is rejected before DNS', async () => {
  const gate = probe();
  const receipt = await performAgentInvoke(agent('https://evil.example/run'), invoke, snapshots, { env: env('chem.buddy.test'), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-host' });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.error?.code, 'upstream_not_allowed');
  assert.equal(gate.looked.length, 0);
  assert.equal(gate.requested.length, 0);
});

test('loopback, mapped loopback, metadata and link-local never connect', async () => {
  const cases = [
    'http://127.0.0.1/latest',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:169.254.169.254]/',
    'http://100.100.100.200/',
    'http://localhost/v1',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://[fe80::1]/',
    'http://[fd00:ec2::254]/',
  ];
  for (const upstream of cases) {
    const gate = probe();
    const allow = parseAllowlist('127.0.0.1,2130706433,::1,::ffff:7f00:1,169.254.169.254,::ffff:a9fe:a9fe,100.100.100.200,localhost,metadata.google.internal,fe80::1,fd00:ec2::254,0.0.0.0/0');
    const verdict = await vetUpstream(upstream, allow, gate.lookup);
    assert.equal(verdict.ok, false, upstream);
    if (verdict.ok) continue;
    assert.ok(verdict.reason === 'metadata' || verdict.reason === 'address', `${upstream} ${verdict.reason}`);
    const receipt = await performAgentInvoke(agent(upstream), invoke, snapshots, { env: env('127.0.0.1,::1,169.254.169.254,localhost,metadata.google.internal,100.100.100.200,fe80::1,fd00:ec2::254'), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-block' });
    assert.equal(receipt.status, 'failed', upstream);
    assert.equal(receipt.error?.code, 'upstream_not_allowed', upstream);
    assert.equal(gate.requested.length, 0, upstream);
  }
});

test('an allowlisted name that resolves to loopback or metadata is rejected after DNS', async () => {
  for (const address of ['127.0.0.1', '169.254.169.254', '0.0.0.0', '::1']) {
    const gate = probe();
    gate.lookup = async host => { gate.looked.push(host); return ['10.2.14.20', address]; };
    const receipt = await performAgentInvoke(agent('http://chem.buddy.test/v1'), invoke, snapshots, { env: env('chem.buddy.test'), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-mix' });
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.error?.code, 'upstream_not_allowed');
    assert.deepEqual(gate.looked, ['chem.buddy.test']);
    assert.equal(gate.requested.length, 0);
  }
});

test('userinfo, non-http protocols and undeclared ports do not connect', async () => {
  const allow = parseAllowlist('chem.buddy.test');
  const lookup: DnsLookup = async () => { throw new Error('dns'); };
  for (const upstream of ['http://user:secret@chem.buddy.test/v1', 'http://@chem.buddy.test/v1', 'ftp://chem.buddy.test/v1', 'http://chem.buddy.test:8080/v1']) {
    const verdict = await vetUpstream(upstream, allow, lookup);
    assert.equal(verdict.ok, false, upstream);
  }
  const gate = probe();
  const receipt = await performAgentInvoke(agent('http://user:secret@chem.buddy.test/v1'), invoke, snapshots, { env: env('chem.buddy.test'), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-user' });
  assert.equal(receipt.error?.code, 'upstream_not_allowed');
  assert.equal(gate.requested.length, 0);
  const port = await performAgentInvoke(agent('https://chem.buddy.test:8443/v1'), invoke, snapshots, { env: env('chem.buddy.test'), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-port' });
  assert.equal(port.error?.code, 'upstream_not_allowed');
  assert.equal(gate.looked.length, 0);
});

test('declared ports and default 80/443 are allowed, CIDR cannot open another port', async () => {
  const lookup: DnsLookup = async () => ['10.2.14.20'];
  assert.equal((await vetUpstream('https://chem.buddy.test/v1', parseAllowlist('chem.buddy.test:8443'), lookup)).ok, true);
  assert.equal((await vetUpstream('http://chem.buddy.test:8443/v1', parseAllowlist('chem.buddy.test:8443'), lookup)).ok, true);
  assert.equal((await vetUpstream('http://chem.buddy.test:9443/v1', parseAllowlist('chem.buddy.test:8443'), lookup)).ok, false);
  assert.equal((await vetUpstream('http://10.2.14.20:8443/v1', parseAllowlist('10.2.14.0/24'), lookup)).ok, false);
  assert.equal((await vetUpstream('http://10.2.14.20/v1', parseAllowlist('10.2.14.0/24'), async () => { throw new Error('dns'); })).ok, true);
});

test('RFC1918 is allowed for an allowlisted host or CIDR and denied otherwise', async () => {
  const privateLookup: DnsLookup = async () => ['10.2.14.20'];
  const named = await vetUpstream('http://chem.buddy.test/v1', parseAllowlist('chem.buddy.test'), privateLookup);
  assert.equal(named.ok, true);
  if (named.ok) assert.deepEqual(named.addresses, ['10.2.14.20']);
  const cidr = await vetUpstream('http://runtime.internal/v1', parseAllowlist('10.2.14.0/24'), privateLookup);
  assert.equal(cidr.ok, true);
  const publicOnly = await vetUpstream('http://runtime.internal/v1', parseAllowlist('10.2.14.0/24'), async () => ['1.2.3.4']);
  assert.equal(publicOnly.ok, false);
  let looked = false;
  const unnamed = await vetUpstream('http://runtime.internal/v1', parseAllowlist('chem.buddy.test'), async () => { looked = true; return ['10.2.14.20']; });
  assert.equal(unnamed.ok, false);
  assert.equal(looked, false);
  const mapped = await vetUpstream('http://[::ffff:10.2.14.20]/v1', parseAllowlist('10.0.0.0/8'), async () => { throw new Error('dns'); });
  assert.equal(mapped.ok, true);
});

test('DNS failure is failed and does not call the upstream', async () => {
  const gate = probe();
  const receipt = await performAgentInvoke(agent('http://chem.buddy.test/v1'), invoke, snapshots, { env: env('chem.buddy.test'), lookup: gate.lookup, request: gate.request, now: () => stamp, receiptId: 'receipt-dns' });
  assert.equal(receipt.error?.code, 'upstream_failed');
  assert.match(receipt.error?.message ?? '', /无法解析/);
  assert.equal(gate.requested.length, 0);
});

test('upstream errors and timeouts fail once and are not retried', async () => {
  let calls = 0;
  const failed = await performAgentInvoke(agent('http://chem.buddy.test/v1'), invoke, snapshots, {
    env: env('chem.buddy.test'), lookup: async () => ['10.2.14.20'], now: () => stamp, receiptId: 'receipt-500',
    request: async () => { calls += 1; return { status: 503, body: 'secret-body' }; },
  });
  assert.equal(calls, 1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error?.code, 'upstream_failed');
  assert.match(failed.error?.message ?? '', /503/);
  assert.equal(failed.error?.message.includes('secret-body'), false);
  calls = 0;
  const thrown = await performAgentInvoke(agent('http://chem.buddy.test/v1'), invoke, snapshots, {
    env: env('chem.buddy.test'), lookup: async () => ['10.2.14.20'], now: () => stamp, receiptId: 'receipt-throw',
    request: async () => { calls += 1; throw new Error('connect ECONNREFUSED'); },
  });
  assert.equal(calls, 1);
  assert.equal(thrown.error?.code, 'upstream_failed');
  calls = 0;
  const timed = await performAgentInvoke(agent('http://chem.buddy.test/v1'), invoke, snapshots, {
    env: env('chem.buddy.test'), lookup: async () => ['10.2.14.20'], now: () => stamp, receiptId: 'receipt-time', timeoutMs: 30,
    request: (hop) => new Promise((_resolve, reject) => { calls += 1; setTimeout(() => reject(Object.assign(new Error('upstream timeout'), { code: 'TIMEOUT' })), hop.timeoutMs); }),
  });
  assert.equal(calls, 1);
  assert.equal(timed.error?.code, 'upstream_timeout');
  for (const body of ['<html>', '{"output":1}', '{"meta":{}}']) {
    const bad = await performAgentInvoke(agent('http://chem.buddy.test/v1'), invoke, snapshots, {
      env: env('chem.buddy.test'), lookup: async () => ['10.2.14.20'], now: () => stamp, receiptId: 'receipt-bad',
      request: async () => ({ status: 200, body }),
    });
    assert.equal(bad.status, 'failed');
    assert.equal('output' in bad, false);
  }
});

test('redirects off the allowlist are not requested, and a third redirect stops', async () => {
  const paths: string[] = [];
  const leaked = await performAgentInvoke(agent('http://chem.buddy.test/start'), invoke, snapshots, {
    env: env('chem.buddy.test'), lookup: async () => ['10.2.14.20'], now: () => stamp, receiptId: 'receipt-redirect',
    request: async hop => { paths.push(hop.url.href); return { status: 302, location: 'http://169.254.169.254/latest/meta-data/', body: '' }; },
  });
  assert.deepEqual(paths, ['http://chem.buddy.test/start']);
  assert.equal(leaked.error?.code, 'upstream_not_allowed');
  assert.match(leaked.error?.message ?? '', /重定向/);
  const offHost: string[] = [];
  const looked: string[] = [];
  const foreign = await performAgentInvoke(agent('http://chem.buddy.test/start'), invoke, snapshots, {
    env: env('chem.buddy.test'),
    lookup: async host => { looked.push(host); return ['10.2.14.20']; },
    now: () => stamp, receiptId: 'receipt-foreign',
    request: async hop => { offHost.push(hop.url.hostname); return { status: 302, location: 'https://evil.example/steal', body: '' }; },
  });
  assert.deepEqual(offHost, ['chem.buddy.test']);
  assert.deepEqual(looked, ['chem.buddy.test']);
  assert.equal(foreign.status, 'failed');
  const hops: string[] = [];
  const tooMany = await performAgentInvoke(agent('http://chem.buddy.test/a'), invoke, snapshots, {
    env: env('chem.buddy.test'), lookup: async () => ['1.2.3.4'], now: () => stamp, receiptId: 'receipt-hops',
    request: async hop => {
      hops.push(hop.url.pathname);
      const next: Record<string, string> = { '/a': '/b', '/b': '/c', '/c': '/d' };
      return { status: 307, location: next[hop.url.pathname], body: '' };
    },
  });
  assert.deepEqual(hops, ['/a', '/b', '/c']);
  assert.match(tooMany.error?.message ?? '', /重定向次数/);
  hops.length = 0;
  const followed = await performAgentInvoke(agent('http://chem.buddy.test/a'), invoke, snapshots, {
    env: env('chem.buddy.test'), lookup: async () => ['1.2.3.4'], now: () => stamp, receiptId: 'receipt-followed',
    request: async hop => {
      hops.push(hop.url.pathname);
      if (hop.url.pathname === '/c') return { status: 200, body: JSON.stringify({ output: '两跳之后' }) };
      return { status: 302, location: hop.url.pathname === '/a' ? '/b' : '/c', body: '' };
    },
  });
  assert.deepEqual(hops, ['/a', '/b', '/c']);
  assert.equal(followed.status, 'completed');
  assert.equal(followed.output, '两跳之后');
});

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  const sockets = new Set<net.Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

test('an allowlisted local mock completes with output and the ChemBuddy payload', async () => {
  const seen: { url?: string; authorization?: string; type?: string | string[]; agent?: string; body: string }[] = [];
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => {
      seen.push({ url: req.url, authorization: req.headers.authorization, type: req.headers['content-type'], agent: req.headers['user-agent'], body: Buffer.concat(chunks).toString('utf8') });
      if (req.url === '/start') {
        res.writeHead(302, { location: '/finish' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: '值班完成', meta: { model: 'chem' } }));
    });
  });
  try {
    const upstream = 'http://chem.buddy.test/start';
    const receipt = await performAgentInvoke(agent(upstream), invoke, snapshots, {
      env: env('chem.buddy.test'),
      lookup: async () => ['10.2.14.20'],
      now: () => stamp,
      receiptId: 'receipt-mock',
      request: async hop => {
        assert.equal(hop.url.hostname, 'chem.buddy.test');
        assert.deepEqual(hop.addresses, ['10.2.14.20']);
        assert.equal(classifyAddress(hop.addresses[0]), 'private');
        return nodeUpstreamRequest({ ...hop, url: new URL(hop.url.pathname, `http://127.0.0.1:${server.port}/`), addresses: ['127.0.0.1'] });
      },
    });
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.output, '值班完成');
    assert.equal('meta' in receipt, false);
    assert.equal(receipt.skillsResolved.length, 2);
    assert.equal(receipt.context && (receipt.context as { locale: string }).locale, 'zh-CN');
    assert.deepEqual(seen.map(item => item.url), ['/start', '/finish']);
    assert.equal(seen[0].authorization, undefined);
    assert.match(String(seen[0].type), /application\/json/);
    assert.equal(seen[0].agent, 'SkillHub-AgentHub');
    const hub = agent(upstream);
    assert.deepEqual(JSON.parse(seen[0].body), upstreamPayload(hub, invoke, snapshots, 'receipt-mock'));
    assert.deepEqual(JSON.parse(seen[1].body).agent.skills, [{ skillId: skillA, version: '1.4.0', name: '值班笔记', markdown: '# 值班', digest: 'sha256:abc' }]);
    assert.equal(JSON.parse(seen[0].body).agent.persona, '你是值班助手。');
    assert.deepEqual(JSON.parse(seen[0].body).agent.tools, ['search']);
  } finally {
    await server.close();
  }
});

test('the HTTP client posts once and reports a redirect without following it', async () => {
  const server = await listen((req, res) => {
    if (req.url === '/stay') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest' });
      res.end('go-away');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: 'ok' }));
  });
  try {
    const redirected = await nodeUpstreamRequest({ url: new URL(`http://127.0.0.1:${server.port}/stay`), body: '{"n":1}', timeoutMs: 2000, addresses: ['127.0.0.1'] });
    assert.equal(redirected.status, 302);
    assert.equal(redirected.location, 'http://169.254.169.254/latest');
    const hung = listen((_req, res) => { void res; });
    const pending = await hung;
    await assert.rejects(() => nodeUpstreamRequest({ url: new URL(`http://127.0.0.1:${pending.port}/hang`), body: '{}', timeoutMs: 200, addresses: ['127.0.0.1'] }), (error: unknown) => (error as { code?: string }).code === 'TIMEOUT');
    await pending.close();
  } finally {
    await server.close();
  }
});
