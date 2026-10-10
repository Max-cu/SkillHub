import { parse } from 'yaml';
import { AGENTS, CATEGORIES, type Agent } from './types.ts';
import { MAX_MARKDOWN_BYTES,MAX_MARKDOWN_CHARACTERS } from './package-limits.mjs';

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export async function digest(text: string | Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : Uint8Array.from(text).buffer);
  return 'sha256:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function metadataSlug(name:string) {
  const normalized=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  const ascii=normalized.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if(ascii&&ascii.length<=80&&!/[^\x00-\x7f]/.test(normalized))return ascii;
  // This deterministic suffix identifies a display name, never an authentication identity or content digest.
  let hash=BigInt("14695981039346656037");for(const byte of new TextEncoder().encode(name))hash=BigInt.asUintN(64,(hash^BigInt(byte))*BigInt("1099511628211"));
  return (ascii.slice(0,60).replace(/-$/,'')||'skill')+'-'+hash.toString(16).padStart(16,'0');
}
export function parseSkill(markdown:string,context:{fallbackName?:string;defaultName?:string;preferredName?:string;preferredSlug?:string}={}) {
  if(typeof markdown!=='string'||!markdown.trim()||new TextEncoder().encode(markdown).length>MAX_MARKDOWN_BYTES||[...markdown].length>MAX_MARKDOWN_CHARACTERS)throw new ApiError(400,'invalid_markdown','SKILL.md 须为非空 UTF-8 文本，最多 200000 字符');
  const normalized=markdown.replace(/^\uFEFF/,''),lines=normalized.split(/\r?\n/),warnings:string[]=[];
  let meta:Record<string,unknown>={},body=normalized;
  if(lines[0]?.trim()==='---') {
    const closing=lines.findIndex((line,index)=>index>0&&line.trim()==='---');
    if(closing<0)throw new ApiError(400,'invalid_frontmatter','SKILL.md 的 YAML Frontmatter 未闭合');
    let parsed:unknown;try{parsed=parse(lines.slice(1,closing).join('\n'),{maxAliasCount:20})??{};}catch{throw new ApiError(400,'invalid_yaml','SKILL.md 的 YAML 格式无效');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new ApiError(400,'invalid_metadata','YAML Frontmatter 须为对象');
    meta=parsed as Record<string,unknown>;body=lines.slice(closing+1).join('\n');
  }
  const heading=body.match(/^#\s+(.+?)\s*$/m)?.[1].replace(/[*_`#]/g,'').trim();
  const name=(context.preferredName||(typeof meta.name==='string'?meta.name.trim():'')||context.fallbackName||heading||context.defaultName||'Imported Skill').slice(0,120);
  const paragraph:string[]=[];
  for(const raw of body.split('\n')){const line=raw.trim();if(!line){if(paragraph.length)break;continue;}if(/^(#|---|```|\||>)/.test(line))continue;const clean=line.replace(/[*_`\[\]()]/g,'').replace(/^[- ]+/,'').trim();if(clean)paragraph.push(clean);}
  const declared=typeof meta.description==='string'?meta.description.trim():'';
  const description=(declared||paragraph.join(' ')||`${name}：从 SKILL.md 导入，AI 将继续整理用途说明。`).slice(0,20000);
  if(!meta.name||!declared)warnings.push('缺少标准 name/description，已从目录、标题或正文推断资料。');
  if(!body.trim())warnings.push('技能正文为空，请在社区发布前完善。');
  return {name,description,slug:metadataSlug(context.preferredSlug||name),warnings};
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
export function validatePublish(body: Record<string, unknown>,packageMetadata?:ReturnType<typeof parseSkill>) {
  const markdown = body.markdown as string; const meta = packageMetadata??parseSkill(markdown);
  const version = body.version;
  if (typeof version !== 'string' || version.length > 32 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.split('.').some(v => Number(v)>999999999)) throw new ApiError(400, 'invalid_version', '版本必须为 x.y.z，每段不超过 999999999');
  if (!CATEGORIES.includes(body.category as typeof CATEGORIES[number])) throw new ApiError(400, 'invalid_category', '请选择技能分类');
  if (!Array.isArray(body.agents) || !body.agents.length || body.agents.length > AGENTS.length) throw new ApiError(400, 'invalid_agents', '至少声明一个适用 Agent');
  const agents = [...new Set(body.agents.map(validAgent))];
  if (typeof body.license !== 'string' || !body.license.trim() || body.license.length > 80) throw new ApiError(400, 'invalid_license', '请填写许可证');
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 10 || body.tags.some(t => typeof t !== 'string' || t.length > 30))) throw new ApiError(400, 'invalid_tags', '最多 10 个标签，每个不超过 30 字符');
  const id = body.id ?? meta.slug;
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 100) throw new ApiError(400, 'invalid_id', '无效的技能 ID');
  if (body.description !== undefined && (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 20000)) throw new ApiError(400, 'invalid_description', '描述须为 1–20000 字符');
  if (body.changelog !== undefined && (typeof body.changelog !== 'string' || body.changelog.length > 2000)) throw new ApiError(400, 'invalid_changelog', '更新说明最多 2000 字符');
  return { id, ...meta, description: (body.description as string) || meta.description, markdown, version, category: body.category as string, agents, license: body.license.trim(), tags: body.tags ?? [], changelog: body.changelog ?? 'Initial release' };
}
// Owner edits target display metadata of the latest private version; SKILL.md, ZIP and approved presentations stay immutable.
export function validateMetadataUpdate(body: Record<string, unknown>) {
  if (!['name','description','category','agents','tags','license'].some(field => body[field] !== undefined)) throw new ApiError(400,'invalid_input','至少提供一项要更新的资料');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120)) throw new ApiError(400,'invalid_name','名称须为 1–120 字符');
  if (body.description !== undefined && (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 20000)) throw new ApiError(400,'invalid_description','描述须为 1–20000 字符');
  if (body.category !== undefined && !CATEGORIES.includes(body.category as typeof CATEGORIES[number])) throw new ApiError(400,'invalid_category','请选择技能分类');
  if (body.agents !== undefined && (!Array.isArray(body.agents) || !body.agents.length || body.agents.length > AGENTS.length)) throw new ApiError(400,'invalid_agents','至少声明一个适用 Agent');
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 10 || body.tags.some(t => typeof t !== 'string' || t.length > 30))) throw new ApiError(400,'invalid_tags','最多 10 个标签，每个不超过 30 字符');
  if (body.license !== undefined && (typeof body.license !== 'string' || !body.license.trim() || body.license.length > 80)) throw new ApiError(400,'invalid_license','请填写许可证');
  const text = (value: unknown, fallback?: string) => typeof value === 'string' ? value.trim() : fallback;
  return {
    name: text(body.name), description: text(body.description), license: text(body.license),
    category: body.category as string | undefined,
    agents: body.agents !== undefined ? [...new Set(body.agents.map(validAgent))] : undefined,
    tags: body.tags !== undefined ? (body.tags as string[]).map(t => t.trim()) : undefined,
  };
}
export function compareVersion(a: string, b: string) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
}
