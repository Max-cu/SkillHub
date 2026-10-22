import { ApiError, metadataSlug } from './domain.ts';
import { AGENT_SKILL_ID, type AgentConfig, type AgentSkillRef, type AgentStatus, type HubAgent } from './types.ts';

export const AGENT_STATUSES = ['draft', 'published'] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AgentRow = {
  id: string; slug: string; name: string; description: string; owner: string;
  config: string; status: string; createdAt: string; updatedAt: string;
};
export type AgentWrite = { name: string; slug: string | null; description: string; status: AgentStatus; config: AgentConfig };
export type AgentPatch = { name?: string; slug?: string; description?: string; status?: AgentStatus; config?: Partial<AgentConfig> };
export type AgentInvoke = { input: string; context?: unknown };
export type AgentSkillDraft = { skillId: string; version?: string } | { slug: string; version?: string };
export type AgentSkillSnapshot = {
  skillId: string; version?: string; resolved: boolean;
  name?: string; digest?: string; markdown?: string;
};
export type ReadableSkillVersion = {
  skillId: string; version: string; name: string; digest: string; markdown: string;
  owner: string; communityBlocked: boolean;
};
export type SkillAccess = {
  resolveSlug: (userId: string, slug: string) => Promise<string | null | 'ambiguous'>;
  read: (userId: string, skillId: string, version?: string) => Promise<ReadableSkillVersion | null>;
};
export type AgentReceipt = {
  receiptId: string; status: 'accepted'; timestamp: string; input: string; context: unknown;
  skillsResolved: AgentSkillSnapshot[];
  agent: { id: string; name: string; slug: string; status: AgentStatus; config: AgentConfig };
};
const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_MARKDOWN_EXCERPT = 2000;

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
function parseSkillVersion(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 32 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.split('.').some(part => Number(part) > 999999999)) throw new ApiError(400, 'invalid_version', '技能版本必须为 x.y.z');
  return value;
}
function skillRef(skillId: string, version?: string): AgentSkillRef {
  return version ? { skillId, version } : { skillId };
}
function skillItems(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) throw new ApiError(400, 'invalid_skill', 'skills 最多 20 项');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, 'invalid_skill', '技能引用须为对象');
    return item as Record<string, unknown>;
  });
}
export function parseSkillDrafts(value: unknown): AgentSkillDraft[] {
  const out: AgentSkillDraft[] = [];
  const index = new Map<string, number>();
  for (const raw of skillItems(value)) {
    const version = parseSkillVersion(raw.version);
    let draft: AgentSkillDraft;
    if (raw.skillId !== undefined && raw.skillId !== '') {
      if (typeof raw.skillId !== 'string' || !AGENT_SKILL_ID.test(raw.skillId)) throw new ApiError(400, 'invalid_skill', 'skillId 须为 sk- 加 36 位标识');
      draft = version ? { skillId: raw.skillId, version } : { skillId: raw.skillId };
    } else if (typeof raw.slug === 'string' && raw.slug) {
      if (raw.slug.length > 100 || !SKILL_SLUG.test(raw.slug)) throw new ApiError(400, 'invalid_skill', 'slug 只能使用小写字母、数字和连字符');
      draft = version ? { slug: raw.slug, version } : { slug: raw.slug };
    } else throw new ApiError(400, 'invalid_skill', '技能引用须提供 skillId');
    const key = 'skillId' in draft ? 'id:' + draft.skillId : 'slug:' + draft.slug;
    const at = index.get(key);
    if (at === undefined) { index.set(key, out.length); out.push(draft); }
    else out[at] = draft;
  }
  return out;
}
function parseStoredSkillRefs(value: unknown): AgentSkillRef[] {
  return parseSkillDrafts(value).map(draft => {
    if (!('skillId' in draft)) throw new ApiError(400, 'invalid_skill', '技能引用须提供 skillId');
    return skillRef(draft.skillId, draft.version);
  });
}
function dedupeSkillRefs(refs: AgentSkillRef[]) {
  const map = new Map<string, AgentSkillRef>();
  for (const ref of refs) map.set(ref.skillId, skillRef(ref.skillId, ref.version));
  return [...map.values()];
}
function visibleSkill(userId: string, skill: ReadableSkillVersion | null) {
  if (!skill || (skill.communityBlocked && skill.owner !== userId)) return null;
  return skill;
}
// Write-time check. Agent status is intentionally unused: published does not widen skill visibility.
export async function assertSkillsAccessible(userId: string, drafts: AgentSkillDraft[], access: SkillAccess): Promise<AgentSkillRef[]> {
  const resolved: AgentSkillRef[] = [];
  for (const draft of drafts) {
    let skillId: string;
    if ('skillId' in draft) skillId = draft.skillId;
    else {
      const found = await access.resolveSlug(userId, draft.slug);
      if (found === 'ambiguous') throw new ApiError(400, 'ambiguous_skill', '多个技能使用该标识，请改用 skillId');
      if (!found || !AGENT_SKILL_ID.test(found)) throw new ApiError(404, 'skill_not_found', '技能或可访问版本不存在');
      skillId = found;
    }
    const visible = visibleSkill(userId, await access.read(userId, skillId));
    if (!visible) throw new ApiError(404, 'skill_not_found', '技能或可访问版本不存在');
    if (draft.version) {
      const exact = visibleSkill(userId, await access.read(userId, skillId, draft.version));
      if (!exact) throw new ApiError(400, 'skill_version_unavailable', '该技能版本当前不可读');
    }
    resolved.push(skillRef(skillId, draft.version));
  }
  return dedupeSkillRefs(resolved);
}
export function omitAgentSkills(input: Record<string, unknown>): Record<string, unknown> {
  const config = input.config;
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.prototype.hasOwnProperty.call(config, 'skills')) return input;
  const rest = { ...(config as Record<string, unknown>) };
  delete rest.skills;
  return { ...input, config: rest };
}
export async function authorizeAgentSkillWrites(userId: string, input: Record<string, unknown>, access: SkillAccess) {
  const config = input.config;
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.prototype.hasOwnProperty.call(config, 'skills')) return input;
  const skills = await assertSkillsAccessible(userId, parseSkillDrafts((config as Record<string, unknown>).skills), access);
  return { ...input, config: { ...(config as Record<string, unknown>), skills } };
}
export async function resolveSkillSnapshots(userId: string, refs: AgentSkillRef[], access: Pick<SkillAccess, 'read'>): Promise<AgentSkillSnapshot[]> {
  const snapshots: AgentSkillSnapshot[] = [];
  for (const ref of refs) {
    const skill = visibleSkill(userId, await access.read(userId, ref.skillId, ref.version));
    if (!skill) {
      snapshots.push(ref.version ? { skillId: ref.skillId, version: ref.version, resolved: false } : { skillId: ref.skillId, resolved: false });
      continue;
    }
    snapshots.push({ skillId: skill.skillId, version: skill.version, name: skill.name, digest: skill.digest, markdown: skill.markdown.slice(0, SKILL_MARKDOWN_EXCERPT), resolved: true });
  }
  return snapshots;
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
  if (value === undefined) return partial ? {} : { persona: '', tools: [], skills: [], upstreamUrl: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_config', 'config 须为对象');
  const raw = value as Record<string, unknown>, out: Partial<AgentConfig> = {};
  if (!partial || raw.persona !== undefined) out.persona = optionalText(raw.persona, 'persona', 20000);
  if (!partial || raw.tools !== undefined) out.tools = raw.tools === undefined ? [] : parseTools(raw.tools);
  if (!partial || raw.skills !== undefined) out.skills = raw.skills === undefined ? [] : parseStoredSkillRefs(raw.skills);
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
  return {
    persona: patch.persona ?? current.persona,
    tools: patch.tools ?? current.tools,
    skills: patch.skills ?? current.skills ?? [],
    upstreamUrl: patch.upstreamUrl === undefined ? current.upstreamUrl : patch.upstreamUrl,
  };
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
export function agentReceipt(agent: HubAgent, invoke: AgentInvoke, timestamp = new Date().toISOString(), receiptId = crypto.randomUUID(), skillsResolved: AgentSkillSnapshot[] = []): AgentReceipt {
  return {
    receiptId, status: 'accepted', timestamp, input: invoke.input, context: invoke.context ?? null, skillsResolved,
    agent: { id: agent.id, name: agent.name, slug: agent.slug, status: agent.status, config: agent.config },
  };
}
