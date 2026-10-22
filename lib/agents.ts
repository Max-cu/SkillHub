import { ApiError, metadataSlug } from './domain.ts';
import type { AgentConfig, AgentStatus, HubAgent } from './types.ts';

export const AGENT_STATUSES = ['draft', 'published'] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AgentRow = {
  id: string; slug: string; name: string; description: string; owner: string;
  config: string; status: string; createdAt: string; updatedAt: string;
};
export type AgentWrite = { name: string; slug: string | null; description: string; status: AgentStatus; config: AgentConfig };
export type AgentPatch = { name?: string; slug?: string; description?: string; status?: AgentStatus; config?: Partial<AgentConfig> };
export type AgentInvoke = { input: string; context?: unknown };
export type AgentReceipt = {
  receiptId: string; status: 'accepted'; timestamp: string; input: string; context: unknown;
  agent: { id: string; name: string; slug: string; status: AgentStatus; config: AgentConfig };
};

export function defaultAgentSlug(name: string) {
  return metadataSlug(name, 'agent');
}
function textField(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ApiError(400, 'invalid_input', `${field} 长度须为 ${min}–${max} 字符`);
  return value.trim();
}
function optionalText(value: unknown, field: string, max: number) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) throw new ApiError(400, 'invalid_input', `${field} 最多 ${max} 字符`);
  return value.trim();
}
export function parseSlug(value: unknown) {
  const slug = textField(value, 'slug', 1, 100);
  if (!SLUG.test(slug)) throw new ApiError(400, 'invalid_slug', 'slug 只能使用小写字母、数字和连字符');
  return slug;
}
function parseStatus(value: unknown, fallback: AgentStatus = 'draft') {
  if (value === undefined) return fallback;
  if (!AGENT_STATUSES.includes(value as AgentStatus)) throw new ApiError(400, 'invalid_status', 'status 为 draft 或 published');
  return value as AgentStatus;
}
function parseTools(value: unknown) {
  if (!Array.isArray(value) || value.length > 20 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 40)) throw new ApiError(400, 'invalid_tools', 'tools 最多 20 项，每项 1–40 字符');
  return [...new Set(value.map(item => (item as string).trim()))];
}
function parseUpstream(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 500) throw new ApiError(400, 'invalid_upstream', 'upstreamUrl 最多 500 字符');
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400, 'invalid_upstream', 'upstreamUrl 须为 http(s) 地址'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ApiError(400, 'invalid_upstream', 'upstreamUrl 须为 http(s) 地址');
  return value;
}
export function validateAgentConfig(value: unknown, partial = false): AgentConfig | Partial<AgentConfig> {
  if (value === undefined) return partial ? {} : { persona: '', tools: [], upstreamUrl: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_config', 'config 须为对象');
  const raw = value as Record<string, unknown>, out: Partial<AgentConfig> = {};
  if (!partial || raw.persona !== undefined) out.persona = optionalText(raw.persona, 'persona', 20000);
  if (!partial || raw.tools !== undefined) out.tools = raw.tools === undefined ? [] : parseTools(raw.tools);
  if (!partial || raw.upstreamUrl !== undefined) out.upstreamUrl = parseUpstream(raw.upstreamUrl);
  return out;
}
export function validateAgentCreate(input: Record<string, unknown>): AgentWrite {
  return {
    name: textField(input.name, 'name', 1, 120),
    slug: input.slug === undefined || input.slug === '' ? null : parseSlug(input.slug),
    description: optionalText(input.description, 'description', 4000),
    status: parseStatus(input.status),
    config: validateAgentConfig(input.config) as AgentConfig,
  };
}
export function validateAgentPatch(input: Record<string, unknown>): AgentPatch {
  if (!['name', 'slug', 'description', 'status', 'config'].some(field => input[field] !== undefined)) throw new ApiError(400, 'invalid_input', '至少提供一项要更新的资料');
  const patch: AgentPatch = {};
  if (input.name !== undefined) patch.name = textField(input.name, 'name', 1, 120);
  if (input.slug !== undefined) patch.slug = parseSlug(input.slug);
  if (input.description !== undefined) patch.description = optionalText(input.description, 'description', 4000);
  if (input.status !== undefined) patch.status = parseStatus(input.status);
  if (input.config !== undefined) patch.config = validateAgentConfig(input.config, true);
  return patch;
}
export function mergeAgentConfig(current: AgentConfig, patch: Partial<AgentConfig> | undefined): AgentConfig {
  if (!patch) return current;
  return { persona: patch.persona ?? current.persona, tools: patch.tools ?? current.tools, upstreamUrl: patch.upstreamUrl === undefined ? current.upstreamUrl : patch.upstreamUrl };
}
export function validateInvoke(input: Record<string, unknown>): AgentInvoke {
  if (typeof input.input !== 'string' || !input.input.trim() || input.input.length > 20000) throw new ApiError(400, 'invalid_input', 'input 须为 1–20000 字符');
  if (input.context !== undefined) {
    let encoded = '';
    try { encoded = JSON.stringify(input.context); } catch { throw new ApiError(400, 'invalid_context', 'context 须为可序列化的 JSON'); }
    if (!encoded || encoded.length > 100_000) throw new ApiError(400, 'invalid_context', 'context 过大');
  }
  return input.context === undefined ? { input: input.input.trim() } : { input: input.input.trim(), context: input.context };
}
export function agentPagination(params: URLSearchParams) {
  const offset = Number(params.get('offset') ?? 0), limit = Number(params.get('limit') ?? 24);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_pagination', 'offset ≥ 0，limit 为 1–100');
  return { offset, limit };
}
export function mapAgent(row: AgentRow): HubAgent {
  let parsed: unknown;
  try { parsed = JSON.parse(row.config); } catch { throw new ApiError(500, 'invalid_agent', 'Agent 配置无法读取'); }
  if (row.status !== 'draft' && row.status !== 'published') throw new ApiError(500, 'invalid_agent', 'Agent 状态无效');
  return {
    id: row.id, slug: row.slug, name: row.name, description: row.description, owner: row.owner,
    config: validateAgentConfig(parsed) as AgentConfig, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
export function agentReceipt(agent: HubAgent, invoke: AgentInvoke, timestamp = new Date().toISOString(), receiptId = crypto.randomUUID()): AgentReceipt {
  return {
    receiptId, status: 'accepted', timestamp, input: invoke.input, context: invoke.context ?? null,
    agent: { id: agent.id, name: agent.name, slug: agent.slug, status: agent.status, config: agent.config },
  };
}
