import { getDb, type PgStatement } from '../db/index';
import { assertDatabase } from '../db/postgres.mjs';
import catalog from './catalog.json';
import { ApiError, compareVersion, digest, permissions, validAgent, validatePublish } from './domain';
import { AGENTS, CATEGORIES, type Skill } from './types';
import { openapi } from './openapi';
import { messagePagination, validateMessage, type BoardMessage } from './board';
import { inspectPackage, markdownPackage, packageTemplate, MAX_ZIP_BYTES, type PackageInfo } from './package';
import { workspaceMode } from './workspace';
import { authConfig, handleAuth, sessionIdentity, checkBrowserMutation } from './auth';

const now = () => new Date().toISOString();
const db = getDb;
let seeded: Promise<void> | undefined;
export function seedCatalog() {
  return seeded ??= (async () => {
    const database = db();
    const statements = catalog.flatMap(s => [
      database.prepare('INSERT INTO skills (id,name,description,category,agents,tags,source,source_path,"commit",license,owner,featured,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING').bind(s.id, s.name, s.description, s.category, JSON.stringify(s.agents), JSON.stringify(s.tags), s.source, s.sourcePath, s.commit, s.license, 'upstream-catalog', +s.featured, s.createdAt),
      database.prepare('INSERT INTO versions (skill_id,version,markdown,digest,"commit",changelog,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING').bind(s.id, s.version, s.markdown, s.digest, s.commit, 'Public upstream SKILL.md snapshot; auxiliary files are not bundled.', s.createdAt),
    ]);
    await database.batch(statements);
  })().catch(error => { seeded = undefined; throw error; });
}
type Identity = { userId: string; scope: 'read' | 'write'; displayName?:string; email?: string; kind: 'key' | 'local' | 'session' };
const identities=new WeakMap<Request,Identity|null>();
async function identity(request: Request, required = false, write = false): Promise<Identity | null> {
  const config=authConfig();
  const auth = request.headers.get('authorization');
  let result: Identity | null = null;
  if(identities.has(request))result=identities.get(request)??null;
  else if (auth) {
    if (!auth.startsWith('Bearer sg_')) throw new ApiError(401, 'invalid_key', 'API Key 无效');
    const hash = await digest(auth.slice(7));
    const key = await db().prepare('SELECT k.user_id,k.scope FROM api_keys k '+(config.mode==='cas'?'JOIN auth_users u ON u.id=k.user_id ':'')+'WHERE k.hash=$1').bind(hash).first<{user_id:string;scope:'read'|'write'}>();
    if (!key) throw new ApiError(401, 'invalid_key', 'API Key 无效或已撤销');
    result = { userId: key.user_id, scope: key.scope, kind: 'key' };
  } else {
    if(config.mode==='cas')result=await sessionIdentity(request);
    else if (workspaceMode(new URL(request.url))==='local') result = {userId:'local-workspace',displayName:'本地工作区',scope:'write',kind:'local'};
  }
  identities.set(request,result);
  if (required && !result) throw new ApiError(401, 'sign_in_required', '请先登录后使用此功能');
  if (write && result) {
    if (result.scope !== 'write') throw new ApiError(403, 'insufficient_scope', '该 API Key 只有读取权限');
    if (result.kind !== 'key') checkBrowserMutation(request,config.mode==='cas'?new URL(config.service).origin:undefined);
  }
  return result;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'unsupported_media', '使用 application/json');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 200_000) throw new ApiError(413, 'payload_too_large', '请求不得超过 200 KB');
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError(400, 'invalid_json', 'JSON 对象格式无效'); }
}
const json = (data: unknown, status = 200) => Response.json({ data }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const messageQuery = 'SELECT id,author,content,color,created_at AS "createdAt",position_x AS "positionX",position_y AS "positionY" FROM messages';
type MessageRow = Omit<BoardMessage,'position'> & {positionX:number|null;positionY:number|null};
function mapMessage({positionX,positionY,...row}:MessageRow):BoardMessage {
  return {...row,position:positionX===null||positionY===null?null:{x:positionX,y:positionY}};
}
const latestOrder = `split_part(v2.version,'.',1)::integer DESC, split_part(v2.version,'.',2)::integer DESC, split_part(v2.version,'.',3)::integer DESC`;
const skillQuery = `SELECT s.*,v.version,v.markdown,v.digest,(SELECT count(*)::integer FROM favorites f WHERE f.skill_id=s.id) AS favorite_count FROM skills s JOIN versions v ON v.skill_id=s.id AND v.version=(SELECT v2.version FROM versions v2 WHERE v2.skill_id=s.id ORDER BY ${latestOrder} LIMIT 1)`;
const visibleOwner = ()=>authConfig().mode==='cas'?"(s.owner='upstream-catalog' OR EXISTS(SELECT 1 FROM auth_users u WHERE u.id=s.owner))":'true';
function mapSkill(row: Record<string, unknown>, favoriteIds: string[] = []): Skill {
  const markdown = row.markdown as string;
  return { id: row.id as string, name: row.name as string, description: row.description as string, category: row.category as Skill['category'], agents: JSON.parse(row.agents as string), tags: JSON.parse(row.tags as string), source: row.source as string, sourcePath: row.source_path as string, commit: row.commit as string | null, license: row.license as string, owner: row.owner as string, featured: !!row.featured, createdAt: row.created_at as string, version: row.version as string, markdown, digest: row.digest as string, tokenEstimate: Math.ceil(markdown.length / 4), permissions: permissions(markdown), favorite: favoriteIds.includes(row.id as string), favoriteCount: Number(row.favorite_count ?? 0) };
}
async function allSkills(userId?: string) {
  const [rows, fav] = await Promise.all([
    db().prepare(skillQuery+' WHERE '+visibleOwner()).all<Record<string, unknown>>(),
    userId ? db().prepare('SELECT skill_id FROM favorites WHERE user_id=$1').bind(userId).all<{skill_id:string}>() : Promise.resolve({results:[]}),
  ]);
  return rows.results.map(r => mapSkill(r, fav.results.map(f => f.skill_id)));
}
async function getSkill(id: string, userId?: string) {
  const row = await db().prepare(skillQuery + ' WHERE s.id=$1 AND '+visibleOwner()).bind(id).first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, 'skill_not_found', '技能不存在');
  const favorited = userId ? await db().prepare('SELECT skill_id FROM favorites WHERE user_id=$1 AND skill_id=$2').bind(userId, id).first() : null;
  return mapSkill(row, favorited ? [id] : []);
}
function textInput(value: unknown, field: string, min = 1, max = 500) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ApiError(400, 'invalid_input', `${field} 长度须为 ${min}–${max} 字符`);
  return value.trim();
}
async function publish(input: Record<string, unknown>, userId: string, archive: {bytes:Uint8Array;info:PackageInfo;filename:string;digest:string}) {
  const s = validatePublish(input); const database = db(); const time = now();
  const existing = await database.prepare('SELECT owner,source,source_path FROM skills WHERE id=$1').bind(s.id).first<{owner:string;source:string;source_path:string}>();
  if (existing && existing.owner !== userId) throw new ApiError(403, 'not_owner', '该名称已被占用，请使用其他技能 ID');
  if (existing) {
    const previous = await getSkill(s.id);
    if (compareVersion(s.version, previous.version) <= 0) throw new ApiError(409, 'version_conflict', '新版本必须高于当前版本；已发布版本不可覆盖');
  }
  const contentDigest = await digest(s.markdown);
  const statements: PgStatement[] = [];
  if (!existing) statements.push(database.prepare('INSERT INTO skills (id,name,description,category,agents,tags,source,source_path,"commit",license,owner,featured,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)').bind(s.id, s.name, s.description, s.category, JSON.stringify(s.agents), JSON.stringify(s.tags), '', archive.info.root + 'SKILL.md', null, s.license, userId, 0, time));
  else statements.push(database.prepare('UPDATE skills SET description=$1,category=$2,agents=$3,tags=$4,license=$5,source=$6,source_path=$7,"commit"=$8 WHERE id=$9 AND owner=$10').bind(s.description, s.category, JSON.stringify(s.agents), JSON.stringify(s.tags), s.license, '', archive.info.root + 'SKILL.md', null, s.id, userId));
  statements.push(database.prepare('INSERT INTO versions (skill_id,version,markdown,digest,"commit",changelog,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)').bind(s.id, s.version, s.markdown, contentDigest, null, s.changelog, time));
  statements.push(database.prepare('INSERT INTO packages (skill_id,version,digest,size,filename,root,files) VALUES ($1,$2,$3,$4,$5,$6,$7)').bind(s.id,s.version,archive.digest,archive.bytes.length,archive.filename,archive.info.root,JSON.stringify(archive.info.files)));
  for (let offset=0,index=0;offset<archive.bytes.length;offset+=512*1024,index++) statements.push(database.prepare('INSERT INTO package_chunks (skill_id,version,chunk_index,content) VALUES ($1,$2,$3,$4)').bind(s.id,s.version,index,archive.bytes.slice(offset,offset+512*1024).buffer));
  try { await database.batch(statements); } catch (error) { if ((error as {code?:string}).code === '23505') throw new ApiError(409, 'version_conflict', '名称或版本已存在'); throw error; }
  return getSkill(s.id, userId);
}
async function upload(request: Request) {
  const type=request.headers.get('content-type')??'';
  if (!type.startsWith('multipart/form-data')) throw new ApiError(415,'zip_required','发布仅支持 multipart/form-data 的 ZIP 文件');
  const max=MAX_ZIP_BYTES+200_000, reader=request.body?.getReader();
  if (!reader) throw new ApiError(400,'file_required','请选择 ZIP 技能包');
  let length=0;const chunks:Uint8Array[]=[];
  for (;;) {const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new ApiError(413,'package_too_large','ZIP 最大为 5 MB');}chunks.push(value);}
  const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  let form:FormData;try{form=await new Response(bytes,{headers:{'Content-Type':type}}).formData();}catch{throw new ApiError(400,'invalid_form','上传表单格式无效');}
  const file=form.get('file');
  if (!file || typeof file==='string' || !file.name.toLowerCase().endsWith('.zip') || form.getAll('file').length!==1) throw new ApiError(400,'zip_required','请选择一个 .zip 技能包');
  if (form.has('url') || form.has('markdown')) throw new ApiError(400,'unsupported_source','仅支持 ZIP 上传');
  const archiveBytes=new Uint8Array(await file.arrayBuffer()), info=inspectPackage(archiveBytes);
  const input:Record<string,unknown>={markdown:info.markdown,version:form.get('version')??'0.1.0',category:form.get('category')??'development',license:form.get('license')??'Unspecified'};
  for(const field of ['id','description','changelog']) if(form.has(field))input[field]=form.get(field);
  for(const field of ['agents','tags']){const raw=form.get(field);if(raw!==null){if(typeof raw!=='string')throw new ApiError(400,'invalid_input',field+' 必须是 JSON 数组');try{input[field]=JSON.parse(raw);}catch{throw new ApiError(400,'invalid_input',field+' 必须是 JSON 数组');}}}
  input.agents??=[...AGENTS];input.tags??=[];
  return {input,archive:{bytes:archiveBytes,info,filename:file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'skill.zip',digest:await digest(archiveBytes)}};
}
async function snapshot(id:string,version:string) {
  const row=await db().prepare('SELECT markdown,digest FROM versions WHERE skill_id=$1 AND version=$2').bind(id,version).first<{markdown:string;digest:string}>();
  if(!row)throw new ApiError(404,'version_not_found','版本不存在');return row;
}
async function packageInfo(id:string,version:string,markdown:string) {
  const row=await db().prepare('SELECT digest,size,filename,root,files FROM packages WHERE skill_id=$1 AND version=$2').bind(id,version).first<{digest:string;size:number;filename:string;root:string;files:string}>();
  if(row)return {...row,files:JSON.parse(row.files),kind:'uploaded'};
  const bytes=markdownPackage(markdown);return {digest:await digest(bytes),size:bytes.length,filename:id+'.zip',root:'',files:[{path:'SKILL.md',size:new TextEncoder().encode(markdown).length}],kind:'catalog-markdown'};
}
const zipResponse=(bytes:Uint8Array,name:string,hash:string)=>new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+name+'"','X-Package-Digest':hash,'ETag':'"'+hash+'"','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
export async function handle(request: Request) {
  try {
    // Read incoming bodies with strict size limits before parsing or validation.
    if (request.body) {
      const max = request.headers.get('content-type')?.includes('application/json') ? 200_000 : MAX_ZIP_BYTES + 200_000;
      const reader = request.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) { await reader.cancel(); throw new ApiError(413,'payload_too_large','请求体超出大小限制'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
      request = new Request(request.url, { method: request.method, headers: Object.fromEntries(request.headers), body: bytes.buffer });
    }
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean).map(decodeURIComponent), method = request.method;
    if (method === 'GET' && path[0] === 'openapi.json') return Response.json(openapi, { headers: { 'Cache-Control': 'public, max-age=300' } });
    if (method === 'GET' && path[0] === 'health') {
      try { await assertDatabase(); } catch { throw new ApiError(503,'database_unavailable','SkillHub PostgreSQL 暂不可用'); }
      return json({ status: 'ok', version: '0.4.0', database: 'PostgreSQL' });
    }
    const authResponse=await handleAuth(request,path,body);if(authResponse)return authResponse;
    // The entire registry and board require a CAS session or a user-owned API key.
    await identity(request,true);
    if (method==='GET' && path.length===1 && path[0]==='package-template') {const bytes=packageTemplate();return zipResponse(bytes,'my-skill.zip',await digest(bytes));}
    await seedCatalog();
    if (path[0] === 'messages') {
      if (method === 'GET' && path.length === 1) {
        await identity(request);
        const { offset, limit } = messagePagination(url.searchParams);
        const [count, list] = await Promise.all([
          db().prepare('SELECT count(*)::integer AS total FROM messages').first<{total:number}>(),
          db().prepare(messageQuery+' ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2').bind(limit,offset).all<MessageRow>(),
        ]);
        const total = count?.total ?? 0;
        return json({items:list.results.map(mapMessage),total,offset,limit,nextOffset:offset+limit<total?offset+limit:null});
      }
      if (method === 'GET' && path.length === 2) {
        await identity(request);
        const message = await db().prepare(messageQuery+' WHERE id=$1').bind(path[1]).first<MessageRow>();
        if (!message) throw new ApiError(404,'message_not_found','留言不存在');
        return json(mapMessage(message));
      }
      if (method === 'POST' && path.length === 1) {
        const user = await identity(request,true,true), value = validateMessage(await body(request));
        const message: BoardMessage = {id:crypto.randomUUID(),...value,createdAt:now()};
        await db().prepare('INSERT INTO messages (id,owner,author,content,color,created_at,position_x,position_y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)').bind(message.id,user!.userId,message.author,message.content,message.color,message.createdAt,message.position?.x??null,message.position?.y??null).run();
        return json(message,201);
      }
    }
    if (method === 'GET' && path[0] === 'meta') {
      const user = await identity(request); const list = await allSkills(user?.userId);
      return json({ agents: AGENTS, categories: CATEGORIES, skillCount: list.length, sourceCount: new Set(list.filter(s => s.source).map(s => s.source)).size, favoriteCount: list.filter(s => s.favorite).length, workspace: authConfig().mode==='cas'?'cas':'local', loginConfigured:authConfig().mode==='cas', user: user ? { id:user.userId,displayName:user.displayName,email:user.email,scope:user.scope } : null });
    }
    if (path[0] === 'skills' && !path[1] && method === 'GET') {
      const user = await identity(request, url.searchParams.get('favorites') === 'true'); let list = await allSkills(user?.userId);
      const agent = url.searchParams.get('agent'), category = url.searchParams.get('category'), q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      if (agent) { validAgent(agent); list = list.filter(s => s.agents.includes(agent as Skill['agents'][number])); }
      if (category) { if (!CATEGORIES.includes(category as Skill['category'])) throw new ApiError(400, 'invalid_category', '无效分类'); list = list.filter(s => s.category === category); }
      if (q) list = list.filter(s => [s.name,s.id,s.description,...s.tags,s.source].some(v => v.toLowerCase().includes(q)));
      if (url.searchParams.get('favorites') === 'true') list = list.filter(s => s.favorite);
      const sort = url.searchParams.get('sort') ?? 'featured';
      if (!['featured','newest','name','compact'].includes(sort)) throw new ApiError(400, 'invalid_sort', '无效排序');
      list.sort((a,b) => sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : sort === 'name' ? a.name.localeCompare(b.name) : sort === 'compact' ? a.tokenEstimate - b.tokenEstimate : Number(b.featured)-Number(a.featured) || a.name.localeCompare(b.name));
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 24);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_pagination', 'offset ≥ 0，limit 为 1–100');
      const total = list.length; return json({ items: list.slice(offset,offset+limit).map(({markdown,...s}) => s), total, offset, limit, nextOffset: offset+limit < total ? offset+limit : null });
    }
    if (path[0] === 'skills' && !path[1] && method === 'POST') { const user = await identity(request, true, true); const {input,archive}=await upload(request); return json(await publish(input, user!.userId,archive), 201); }
    if (path[0] === 'skills' && path[1]) {
      const id = path[1], user = await identity(request);
      if (method === 'GET' && path.length === 2) return json(await getSkill(id, user?.userId));
      if (method === 'GET' && path[2] === 'versions') { await getSkill(id); const result = await db().prepare('SELECT version,digest,changelog,created_at,"commit" FROM versions WHERE skill_id=$1').bind(id).all<{version:string}>(); return json(result.results.sort((a,b) => compareVersion(b.version,a.version))); }
      if (method==='GET' && path.length===3 && ['file','download','package'].includes(path[2])) {
        const skill=await getSkill(id), version=url.searchParams.get('version')??skill.version, row=await snapshot(id,version);
        if(path[2]==='file')return new Response(row.markdown,{headers:{'Content-Type':'text/markdown; charset=utf-8','ETag':'"'+row.digest+'"','X-Skill-Digest':row.digest,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
        const info=await packageInfo(id,version,row.markdown);
        if(path[2]==='package')return json({...info,skillId:id,version});
        let bytes:Uint8Array;
        if(info.kind==='uploaded') {
          const chunks=await db().prepare('SELECT content FROM package_chunks WHERE skill_id=$1 AND version=$2 ORDER BY chunk_index').bind(id,version).all<{content:number[]}>();
          bytes=new Uint8Array(info.size);let at=0;for(const chunk of chunks.results){const content=new Uint8Array(chunk.content);bytes.set(content,at);at+=content.length;}
          if(at!==info.size || await digest(bytes)!==info.digest)throw new ApiError(500,'package_corrupt','技能包存储校验失败');
        }else bytes=markdownPackage(row.markdown);
        return zipResponse(bytes,id+'-'+version+'.zip',info.digest);
      }
      if (path[2] === 'favorite' && ['PUT','DELETE'].includes(method)) {
        const writer = await identity(request, true, true); await getSkill(id);
        if (method === 'PUT') await db().prepare('INSERT INTO favorites (user_id,skill_id,created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING').bind(writer!.userId,id,now()).run();
        else await db().prepare('DELETE FROM favorites WHERE user_id=$1 AND skill_id=$2').bind(writer!.userId,id).run();
        return json({ skillId:id, favorite:method==='PUT' });
      }
    }
    if (path[0] === 'keys') {
      const user = await identity(request,true,method!=='GET');
      if (user!.kind === 'key') throw new ApiError(403,'session_required','API Key 管理需要登录会话，不能使用其他 API Key');
      if (method === 'GET' && !path[1]) return json((await db().prepare('SELECT id,name,prefix,scope,created_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC').bind(user!.userId).all()).results);
      if (method === 'POST' && !path[1]) {
        const input = await body(request), name = textInput(input.name,'名称',1,60), scope = input.scope ?? 'read';
        if (!['read','write'].includes(scope as string)) throw new ApiError(400,'invalid_scope','scope 为 read 或 write');
        const total = await db().prepare('SELECT count(*)::integer AS total FROM api_keys WHERE user_id=$1').bind(user!.userId).first<{total:number}>();
        if ((total?.total ?? 0) >= 20) throw new ApiError(409,'key_limit','最多创建 20 个 API Key');
        const token = 'sg_' + Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''); const id = crypto.randomUUID(), time = now();
        await db().prepare('INSERT INTO api_keys (id,user_id,name,hash,prefix,scope,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)').bind(id,user!.userId,name,await digest(token),token.slice(0,11),scope,time).run();
        return json({id,name,scope,token,createdAt:time},201);
      }
      if (method === 'DELETE' && path[1]) { const r = await db().prepare('DELETE FROM api_keys WHERE id=$1 AND user_id=$2').bind(path[1],user!.userId).run(); if (!r.meta.changes) throw new ApiError(404,'key_not_found','API Key 不存在'); return json({deleted:true}); }
    }
    throw new ApiError(404,'route_not_found','接口不存在');
  } catch (error) {
    if (error instanceof ApiError) return Response.json({error:{code:error.code,message:error.message}}, {status:error.status,headers:{'Cache-Control':'no-store'}});
    console.error('SkillHub API failure', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({error:{code:'internal_error',message:'服务暂时不可用，请稍后重试'}},{status:500});
  }
}
