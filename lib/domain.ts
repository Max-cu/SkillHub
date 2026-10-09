import { parse } from 'yaml';
import { AGENTS, CATEGORIES, type Agent } from './types.ts';

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export async function digest(text: string | Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : Uint8Array.from(text).buffer);
  return 'sha256:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function parseSkill(markdown: string) {
  if (typeof markdown !== 'string' || new TextEncoder().encode(markdown).length > 150_000) throw new ApiError(400, 'invalid_markdown', 'SKILL.md 必须小于 150 KB');
  const match = markdown.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new ApiError(400, 'invalid_frontmatter', '请提供含 name 和 description 的 YAML frontmatter');
  let meta: Record<string, unknown>;
  try { meta = parse(match[1], { maxAliasCount: 20 }); } catch { throw new ApiError(400, 'invalid_yaml', 'YAML 格式无效'); }
  if (!meta || typeof meta !== 'object' || typeof meta.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name) || meta.name.length > 80 || typeof meta.description !== 'string' || meta.description.length < 5 || meta.description.length > 2000) throw new ApiError(400, 'invalid_metadata', 'name 应为小写短横线名称，description 为 5–2000 字符');
  if (!match[2].trim()) throw new ApiError(400, 'empty_content', '技能正文不能为空');
  return { name: meta.name, description: meta.description };
}
export function permissions(markdown: string) {
  const result: string[] = [];
  if (/https?:\/\/|fetch\(|curl\b|网络|API/i.test(markdown)) result.push('network');
  if (/writeFile|mkdir|filesystem|文件|save|scripts\//i.test(markdown)) result.push('filesystem');
  if (/\b(npx|npm|bash|shell|exec|python)\b|命令/i.test(markdown)) result.push('shell');
  if (/API_KEY|TOKEN|secret|credential/i.test(markdown)) result.push('credentials');
  return result;
}
export function validAgent(value: unknown): Agent {
  if (!AGENTS.includes(value as Agent)) throw new ApiError(400, 'invalid_agent', '不支持的 Agent');
  return value as Agent;
}
export function validatePublish(body: Record<string, unknown>) {
  const markdown = body.markdown as string; const meta = parseSkill(markdown);
  const version = body.version;
  if (typeof version !== 'string' || version.length > 32 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.split('.').some(v => Number(v)>999999999)) throw new ApiError(400, 'invalid_version', '版本必须为 x.y.z，每段不超过 999999999');
  if (!CATEGORIES.includes(body.category as typeof CATEGORIES[number])) throw new ApiError(400, 'invalid_category', '请选择技能分类');
  if (!Array.isArray(body.agents) || !body.agents.length || body.agents.length > AGENTS.length) throw new ApiError(400, 'invalid_agents', '至少声明一个适用 Agent');
  const agents = [...new Set(body.agents.map(validAgent))];
  if (typeof body.license !== 'string' || !body.license.trim() || body.license.length > 80) throw new ApiError(400, 'invalid_license', '请填写许可证');
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 10 || body.tags.some(t => typeof t !== 'string' || t.length > 30))) throw new ApiError(400, 'invalid_tags', '最多 10 个标签，每个不超过 30 字符');
  const id = body.id ?? meta.name;
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 100) throw new ApiError(400, 'invalid_id', '无效的技能 ID');
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length < 5 || body.description.length > 2000)) throw new ApiError(400, 'invalid_description', '描述须为 5–2000 字符');
  if (body.changelog !== undefined && (typeof body.changelog !== 'string' || body.changelog.length > 2000)) throw new ApiError(400, 'invalid_changelog', '更新说明最多 2000 字符');
  return { id, ...meta, description: (body.description as string) || meta.description, markdown, version, category: body.category as string, agents, license: body.license.trim(), tags: body.tags ?? [], changelog: body.changelog ?? 'Initial release' };
}
export function compareVersion(a: string, b: string) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
}
