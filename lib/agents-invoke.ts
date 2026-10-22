import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { agentReceipt, type AgentInvoke, type AgentReceipt, type AgentSkillSnapshot } from './agents.ts';
import { allowlistIsEmpty, classifyAddress, parseAllowlist, vetUpstream, type DnsLookup } from './agents-ssrf.ts';
import type { HubAgent } from './types.ts';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 2;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_CHARS = 200_000;

export type UpstreamHop = { url: URL; body: string; timeoutMs: number; addresses: string[] };
export type UpstreamResponse = { status: number; location?: string; body: string };
export type UpstreamRequest = (hop: UpstreamHop) => Promise<UpstreamResponse>;
export type InvokeEnv = {
  AGENTHUB_UPSTREAM_ALLOWLIST?: string;
  AGENTHUB_INVOKE_PROXY?: string;
  AGENTHUB_UPSTREAM_TIMEOUT_MS?: string;
};
export type InvokeDeps = {
  env?: InvokeEnv;
  lookup?: DnsLookup;
  request?: UpstreamRequest;
  now?: () => string;
  receiptId?: string;
  timeoutMs?: number;
};

function readInvokeEnv(env: InvokeEnv | NodeJS.ProcessEnv): InvokeEnv {
  return {
    AGENTHUB_UPSTREAM_ALLOWLIST: env.AGENTHUB_UPSTREAM_ALLOWLIST,
    AGENTHUB_INVOKE_PROXY: env.AGENTHUB_INVOKE_PROXY,
    AGENTHUB_UPSTREAM_TIMEOUT_MS: env.AGENTHUB_UPSTREAM_TIMEOUT_MS,
  };
}
export function upstreamTimeoutMs(env: InvokeEnv) {
  const raw = env.AGENTHUB_UPSTREAM_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > 120_000) return DEFAULT_TIMEOUT_MS;
  return value;
}
export async function systemLookup(hostname: string) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map(record => record.address);
}
export function upstreamPayload(agent: HubAgent, invoke: AgentInvoke, skillsResolved: AgentSkillSnapshot[], receiptId: string) {
  return {
    receiptId,
    input: invoke.input,
    context: invoke.context ?? null,
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      persona: agent.config.persona,
      tools: agent.config.tools,
      skills: skillsResolved.filter(item => item.resolved).map(item => ({
        skillId: item.skillId,
        version: item.version,
        name: item.name,
        markdown: item.markdown,
        digest: item.digest,
      })),
    },
  };
}
function pinnedLookup(address: string): net.LookupFunction {
  const family = net.isIP(address);
  const fail = Object.assign(new Error('invalid address'), { code: 'EINVAL' });
  return (_hostname, options, callback) => {
    if (family !== 4 && family !== 6) {
      callback(fail, '', 4);
      return;
    }
    if (typeof options === 'object' && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}
function isTimeout(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  const name = (error as { name?: string }).name;
  return code === 'TIMEOUT' || name === 'TimeoutError';
}
// Caller must pass addresses already approved by vetUpstream. DNS is pinned to
// the first address so a later resolver answer cannot move the connection.
// Redirects are returned, not followed. This client does not retry.
export function nodeUpstreamRequest(hop: UpstreamHop): Promise<UpstreamResponse> {
  const address = hop.addresses[0];
  if (!address || classifyAddress(address) === 'invalid') return Promise.reject(Object.assign(new Error('invalid address'), { code: 'EINVAL' }));
  const secure = hop.url.protocol === 'https:';
  const agent = secure ? new https.Agent({ keepAlive: false, maxSockets: 1 }) : new http.Agent({ keepAlive: false, maxSockets: 1 });
  const request = secure ? https.request : http.request;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      agent.destroy();
      fn();
    };
    const req = request(hop.url, {
      method: 'POST',
      agent,
      lookup: pinnedLookup(address),
      headers: {
        'content-type': 'application/json; charset=utf-8',
        accept: 'application/json',
        'user-agent': 'SkillHub-AgentHub',
        'content-length': Buffer.byteLength(hop.body),
      },
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          res.destroy();
          finish(() => reject(Object.assign(new Error('upstream body too large'), { code: 'UPSTREAM_BODY' })));
        } else chunks.push(chunk);
      });
      res.on('end', () => {
        const location = res.headers.location;
        finish(() => resolve({
          status: res.statusCode ?? 0,
          location: Array.isArray(location) ? location[0] : location,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      res.on('error', error => finish(() => reject(error)));
    });
    timer = setTimeout(() => req.destroy(Object.assign(new Error('upstream timeout'), { code: 'TIMEOUT' })), hop.timeoutMs);
    req.on('error', error => finish(() => reject(error)));
    req.end(hop.body);
  });
}
function failed(agent: HubAgent, invoke: AgentInvoke, timestamp: string, receiptId: string, skillsResolved: AgentSkillSnapshot[], code: 'upstream_not_allowed' | 'upstream_failed' | 'upstream_timeout', message: string): AgentReceipt {
  return agentReceipt(agent, invoke, timestamp, receiptId, skillsResolved, { status: 'failed', error: { code, message } });
}
function mapOutput(agent: HubAgent, invoke: AgentInvoke, timestamp: string, receiptId: string, skillsResolved: AgentSkillSnapshot[], body: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(body.replace(/^\uFEFF/, '')); } catch { return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', '上游响应无法解析'); }
  const output = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { output?: unknown }).output : undefined;
  if (typeof output !== 'string') return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', '上游响应缺少 output');
  if (output.length > MAX_OUTPUT_CHARS) return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', '上游响应过大');
  return agentReceipt(agent, invoke, timestamp, receiptId, skillsResolved, { status: 'completed', output });
}
function nextLocation(current: URL, location: string | undefined) {
  if (!location || location.length > 2048) return null;
  try { return new URL(location, current).href; } catch { return null; }
}

export async function performAgentInvoke(agent: HubAgent, invoke: AgentInvoke, skillsResolved: AgentSkillSnapshot[], deps: InvokeDeps = {}): Promise<AgentReceipt> {
  const env = readInvokeEnv(deps.env ?? process.env);
  const timestamp = deps.now?.() ?? new Date().toISOString();
  const receiptId = deps.receiptId ?? crypto.randomUUID();
  const upstream = agent.config.upstreamUrl;
  if (!upstream || env.AGENTHUB_INVOKE_PROXY?.trim() === '0') return agentReceipt(agent, invoke, timestamp, receiptId, skillsResolved);
  const allowlist = parseAllowlist(env.AGENTHUB_UPSTREAM_ALLOWLIST);
  if (allowlistIsEmpty(allowlist)) return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_not_allowed', '未配置上游允许名单，已拒绝外呼');
  const lookup = deps.lookup ?? systemLookup;
  const request = deps.request ?? nodeUpstreamRequest;
  const timeoutMs = deps.timeoutMs ?? upstreamTimeoutMs(env);
  const body = JSON.stringify(upstreamPayload(agent, invoke, skillsResolved, receiptId));
  let current = upstream;
  const deadline = Date.now() + timeoutMs;
  for (let followed = 0; ; followed += 1) {
    const verdict = await vetUpstream(current, allowlist, lookup);
    if (!verdict.ok) {
      if (verdict.reason === 'dns') return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', followed === 0 ? '上游地址无法解析' : '上游重定向地址无法解析');
      const message = followed === 0 ? '上游地址未通过安全检查，已拒绝外呼' : '上游重定向未通过安全检查，已拒绝继续外呼';
      return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_not_allowed', message);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_timeout', '上游调用超时');
    let response: UpstreamResponse;
    try {
      response = await request({ url: verdict.url, body, timeoutMs: remaining, addresses: verdict.addresses });
    } catch (error) {
      if (isTimeout(error)) return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_timeout', '上游调用超时');
      return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', '上游调用失败');
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (response.status < 200 || response.status >= 300) return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', `上游返回 ${response.status}`);
      return mapOutput(agent, invoke, timestamp, receiptId, skillsResolved, response.body);
    }
    if (followed >= MAX_REDIRECTS) return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', '上游重定向次数过多');
    const next = nextLocation(verdict.url, response.location);
    if (!next) return failed(agent, invoke, timestamp, receiptId, skillsResolved, 'upstream_failed', '上游重定向无效');
    current = next;
  }
}
