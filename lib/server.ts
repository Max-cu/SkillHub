import { getDb, type PgStatement } from '../db/index';
import { assertDatabase, getPool } from '../db/postgres.mjs';
import catalog from './catalog.json';
import { ApiError, compareVersion, digest, permissions, validAgent, validatePublish, validateMetadataUpdate } from './domain';
import { AGENTS, CATEGORIES, type Skill } from './types';
import { openapi } from './openapi';
import { messagePagination, validateMessage, type BoardMessage } from './board';
import { inspectPackage, markdownPackage, packageTemplate, MAX_ZIP_BYTES, type PackageInfo } from './package';
import { workspaceMode } from './workspace';
import { readAiConfig } from './ai-service.mjs';
import { requireAdmin,decideReview,withdrawCommunity,moderateCommunity,retryAi,type Review,type UserRole } from './community';
import { authConfig, handleAuth, sessionIdentity, checkBrowserMutation } from './auth';

const now = () => new Date().toISOString();
const db = getDb;
let seeded: Promise<void> | undefined;
export function seedCatalog() {
  return seeded ??= (async () => {
    const database = db();
    const statements = catalog.flatMap(s => [
      database.prepare('INSERT INTO skills (id,slug,name,description,category,agents,tags,source,source_path,"commit",license,owner,featured,created_at) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING').bind(s.id, s.name, s.description, s.category, JSON.stringify(s.agents), JSON.stringify(s.tags), s.source, s.sourcePath, s.commit, s.license, 'upstream-catalog', +s.featured, s.createdAt),
      database.prepare('INSERT INTO versions (skill_id,version,markdown,digest,"commit",changelog,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING').bind(s.id, s.version, s.markdown, s.digest, s.commit, 'Public upstream SKILL.md snapshot; auxiliary files are not bundled.', s.createdAt),
    ]);
    for(const skill of catalog)statements.push(database.prepare("UPDATE skills SET community_version=$1 WHERE id=$2 AND owner='upstream-catalog' AND community_version IS NULL AND community_blocked=false").bind(skill.version,skill.id));
    await database.batch(statements);
  })().catch(error => { seeded = undefined; throw error; });
}
type Identity = { userId: string; scope: 'read' | 'write'; displayName?:string; email?: string; role:UserRole; kind: 'key' | 'local' | 'session' };
const identities=new WeakMap<Request,Identity|null>();
async function identity(request: Request, required = false, write = false): Promise<Identity | null> {
  const config=authConfig();
  const auth = request.headers.get('authorization');
  let result: Identity | null = null;
  if(identities.has(request))result=identities.get(request)??null;
  else if (auth) {
    if (!auth.startsWith('Bearer sg_')) throw new ApiError(401, 'invalid_key', 'API Key 无效');
    const hash = await digest(auth.slice(7));
    const key = await db().prepare('SELECT k.user_id,k.scope,'+(config.mode==='cas'?'u.role':"'user' AS role")+' FROM api_keys k '+(config.mode==='cas'?'JOIN auth_users u ON u.id=k.user_id ':'')+'WHERE k.hash=$1').bind(hash).first<{user_id:string;scope:'read'|'write';role:UserRole}>();
    if (!key) throw new ApiError(401, 'invalid_key', 'API Key 无效或已撤销');
    result = { userId: key.user_id, scope: key.scope, role:key.role,kind: 'key' };
  } else {
    if(config.mode==='cas')result=await sessionIdentity(request);
    else if (workspaceMode(new URL(request.url))==='local') result = {userId:'local-workspace',displayName:'本地工作区',scope:'write',role:'user',kind:'local'};
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
const newestVersion = `(SELECT v2.version FROM versions v2 WHERE v2.skill_id=s.id ORDER BY ${latestOrder} LIMIT 1)`;
const approvedVersion = `(EXISTS(SELECT 1 FROM community_reviews cr WHERE cr.skill_id=s.id AND cr.version=v.version AND cr.status='approved') OR (s.owner='upstream-catalog' AND v.version=s.community_version))`;
const skillQuery = `SELECT s.*,v.version,v.markdown,v.digest,v.metadata,v.ai_status,v.ai_summary,v.ai_category,v.ai_tags,(SELECT count(*)::integer FROM favorites f WHERE f.skill_id=s.id) AS favorite_count,(SELECT cr.status FROM community_reviews cr WHERE cr.skill_id=s.id AND cr.version=v.version ORDER BY cr.created_at DESC LIMIT 1) AS review_status FROM skills s JOIN versions v ON v.skill_id=s.id`;
function mapSkill(row: Record<string, unknown>, favoriteIds: string[] = [],viewer?:string): Skill {
  const markdown = row.markdown as string, metadata=JSON.parse(row.metadata as string||'{}');
  return { id: row.id as string,importWarnings:viewer===row.owner?(metadata.importWarnings??[]):[],aiStatus:row.ai_status as Skill['aiStatus'],originalDescription:metadata.description??row.description,communityBlocked:!!row.community_blocked,moderationReason:viewer===row.owner?(row.moderation_reason as string):'',slug:row.slug as string,name:metadata.name??row.name, description:row.ai_summary??metadata.description??row.description, category:row.ai_category??metadata.category??row.category, agents:metadata.agents??JSON.parse(row.agents as string), tags:row.ai_tags?JSON.parse(row.ai_tags as string):metadata.tags??JSON.parse(row.tags as string), source: row.source as string, sourcePath:metadata.sourcePath??row.source_path, commit: row.commit as string | null, license:metadata.license??row.license, owner: row.owner as string, featured: !!row.featured, createdAt: row.created_at as string, version: row.version as string, markdown, digest: row.digest as string, communityVersion:row.community_version as string|null,reviewStatus:viewer===row.owner?(row.review_status as Skill['reviewStatus']??null):null, tokenEstimate: Math.ceil(markdown.length / 4), permissions: permissions(markdown), favorite: favoriteIds.includes(row.id as string), favoriteCount: Number(row.favorite_count ?? 0) };
}
async function allSkills(userId:string,scope='mine') {
  if(!['mine','community','all'].includes(scope))throw new ApiError(400,'invalid_scope','scope 为 mine、community 或 all');
  const chosen=scope==='community'?'s.community_version':`CASE WHEN s.owner=$1 THEN ${newestVersion} ELSE s.community_version END`;
  const visible=scope==='mine'?'s.owner=$1':scope==='community'?'s.community_version IS NOT NULL':`(s.owner=$1 OR s.community_version IS NOT NULL)`;
  const [rows, fav] = await Promise.all([
    db().prepare(skillQuery+` WHERE ${visible} AND v.version=${chosen}`+(scope==='community'?' AND $1::text IS NOT NULL':'')).bind(userId).all<Record<string, unknown>>(),
    db().prepare('SELECT skill_id FROM favorites WHERE user_id=$1').bind(userId).all<{skill_id:string}>(),
  ]);
  return rows.results.map(r => mapSkill(r, fav.results.map(f => f.skill_id),userId));
}
async function getSkill(id:string,userId:string,version?:string) {
  const row=await db().prepare(skillQuery+` WHERE s.id=$1 AND (s.owner=$2 OR (s.community_version IS NOT NULL AND ${approvedVersion})) AND v.version=COALESCE($3,CASE WHEN s.owner=$2 THEN ${newestVersion} ELSE s.community_version END)`).bind(id,userId,version??null).first<Record<string,unknown>>();
  if(!row)throw new ApiError(404,'skill_not_found','技能或可访问版本不存在');
  const favorited=await db().prepare('SELECT skill_id FROM favorites WHERE user_id=$1 AND skill_id=$2').bind(userId,id).first();
  return mapSkill(row,favorited?[id]:[],userId);
}
const reviewQuery=`SELECT r.id,r.skill_id AS "skillId",r.version,r.status,r.reason,r.decision_source AS "decisionSource",r.ai_status AS "aiStatus",r.ai_model AS "aiModel",r.created_at AS "createdAt",r.reviewed_at AS "reviewedAt",r.submitter,u.display_name AS "displayName",v.metadata::json->>'name' AS name,COALESCE(v.ai_summary,v.metadata::json->>'description') AS description FROM community_reviews r JOIN auth_users u ON u.id=r.submitter JOIN versions v ON v.skill_id=r.skill_id AND v.version=r.version`;
async function reviewSkill(reviewId:string) {
  const review=await db().prepare('SELECT skill_id,version FROM community_reviews WHERE id=$1').bind(reviewId).first<{skill_id:string;version:string}>();
  if(!review)throw new ApiError(404,'review_not_found','审核记录不存在');
  const row=await db().prepare(skillQuery+' WHERE s.id=$1 AND v.version=$2').bind(review.skill_id,review.version).first<Record<string,unknown>>();
  if(!row)throw new ApiError(404,'skill_not_found','审核版本不存在');return mapSkill(row,[],row.owner as string);
}
function textInput(value: unknown, field: string, min = 1, max = 500) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ApiError(400, 'invalid_input', `${field} 长度须为 ${min}–${max} 字符`);
  return value.trim();
}
async function publish(input: Record<string, unknown>, userId: string, archive: {bytes:Uint8Array;info:PackageInfo;filename:string;digest:string}) {
  const database=db(),time=now(),requestedId=input.id??archive.info.metadata.slug;
  if(typeof requestedId!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedId)||requestedId.length>100)throw new ApiError(400,'invalid_id','无效的技能 ID');
  const existing=await database.prepare('SELECT id,slug FROM skills WHERE owner=$1 AND (id=$2 OR slug=$2)').bind(userId,requestedId).first<{id:string;slug:string}>();
  if(!existing&&/^sk-[a-f0-9-]{36}$/.test(requestedId))throw new ApiError(404,'skill_not_found','技能不存在');
  const skillId=existing?.id??'sk-'+crypto.randomUUID(),slug=existing?.slug??requestedId;
  const previous=existing?await getSkill(skillId,userId):null;
  const explicit=input.version??archive.info.declaredVersion;
  const version=explicit??(previous?previous.version.split('.').map((part,index)=>index===2?Number(part)+1:Number(part)).join('.'):'0.1.0');
  const s=validatePublish({...input,id:requestedId,version},archive.info.metadata);
  if(previous&&compareVersion(s.version,previous.version)<=0)throw new ApiError(409,'version_conflict','新版本必须高于当前版本；已上传版本不可覆盖');
  const contentDigest=await digest(s.markdown),sourcePath=archive.info.entryPath;
  const metadata=JSON.stringify({name:s.name,description:s.description,category:s.category,agents:s.agents,tags:s.tags,license:s.license,sourcePath,importWarnings:archive.info.warnings});
  const statements:PgStatement[]=[];
  if(!existing)statements.push(database.prepare('INSERT INTO skills(id,slug,name,description,category,agents,tags,source,source_path,"commit",license,owner,featured,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)').bind(skillId,slug,s.name,s.description,s.category,JSON.stringify(s.agents),JSON.stringify(s.tags),'',sourcePath,null,s.license,userId,0,time));
  else statements.push(database.prepare('UPDATE skills SET name=$1,description=$2,category=$3,agents=$4,tags=$5,license=$6,source_path=$7 WHERE id=$8 AND owner=$9').bind(s.name,s.description,s.category,JSON.stringify(s.agents),JSON.stringify(s.tags),s.license,sourcePath,skillId,userId));
  statements.push(database.prepare('INSERT INTO versions(skill_id,version,markdown,digest,"commit",changelog,created_at,metadata,ai_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)').bind(skillId,s.version,s.markdown,contentDigest,null,s.changelog,time,metadata,readAiConfig().enabled?'queued':'unprocessed'));
  statements.push(database.prepare('INSERT INTO packages(skill_id,version,digest,size,filename,root,files) VALUES($1,$2,$3,$4,$5,$6,$7)').bind(skillId,s.version,archive.digest,archive.bytes.length,archive.filename,archive.info.root,JSON.stringify(archive.info.files)));
  for(let offset=0,index=0;offset<archive.bytes.length;offset+=512*1024,index++)statements.push(database.prepare('INSERT INTO package_chunks(skill_id,version,chunk_index,content) VALUES($1,$2,$3,$4)').bind(skillId,s.version,index,archive.bytes.slice(offset,offset+512*1024).buffer));
  if(readAiConfig().enabled)statements.push(database.prepare("INSERT INTO ai_jobs(id,kind,skill_id,version) VALUES($1,'summary',$2,$3)").bind(crypto.randomUUID(),skillId,s.version));
  try{await database.batch(statements);}catch(error){if((error as {code?:string}).code==='23505')throw new ApiError(409,'version_conflict','你的技能名称或版本已存在');throw error;}
  return getSkill(skillId,userId);
}
async function upload(request: Request) {
  const type=request.headers.get('content-type')??'';
  if (!type.startsWith('multipart/form-data')) throw new ApiError(415,'zip_required','发布仅支持 multipart/form-data 的 ZIP 文件');
  const max=MAX_ZIP_BYTES+200_000, reader=request.body?.getReader();
  if (!reader) throw new ApiError(400,'file_required','请选择 ZIP 技能包');
  let length=0;const chunks:Uint8Array[]=[];
  for (;;) {const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new ApiError(413,'package_too_large','ZIP 最大为 50 MB');}chunks.push(value);}
  const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  let form:FormData;try{form=await new Response(bytes,{headers:{'Content-Type':type}}).formData();}catch{throw new ApiError(400,'invalid_form','上传表单格式无效');}
  const file=form.get('file');
  if (!file || typeof file==='string' || !file.name.toLowerCase().endsWith('.zip') || form.getAll('file').length!==1) throw new ApiError(400,'zip_required','请选择一个 .zip 技能包');
  if (form.has('url') || form.has('markdown')) throw new ApiError(400,'unsupported_source','仅支持 ZIP 上传');
  const archiveBytes=new Uint8Array(await file.arrayBuffer()), info=inspectPackage(archiveBytes,{filename:file.name});
  const input:Record<string,unknown>={markdown:info.markdown,...(form.get('version')?{version:form.get('version')}:{}),category:form.get('category')??'development',license:form.get('license')??'Unspecified'};
  for(const field of ['id','description','changelog']) if(form.has(field))input[field]=form.get(field);
  for(const field of ['agents','tags']){const raw=form.get(field);if(raw!==null){if(typeof raw!=='string')throw new ApiError(400,'invalid_input',field+' 必须是 JSON 数组');try{input[field]=JSON.parse(raw);}catch{throw new ApiError(400,'invalid_input',field+' 必须是 JSON 数组');}}}
  input.agents??=[...AGENTS];input.tags??=[];
  return {input,archive:{bytes:archiveBytes,info,filename:file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'skill.zip',digest:await digest(archiveBytes)}};
}
async function deleteSkill(skillId:string,owner:string) {
  const client=await getPool().connect();
  try {
    await client.query('BEGIN');
    const row=await client.query('SELECT id FROM skills WHERE id=$1 AND owner=$2 FOR UPDATE',[skillId,owner]);
    if(!row.rows.length)throw new ApiError(404,'skill_not_found','技能不存在');
    // Hard delete removes versions, original ZIP chunks, reviews, moderation notes and other users' favorites in foreign-key order.
    await client.query('DELETE FROM package_chunks WHERE skill_id=$1',[skillId]);
    await client.query('DELETE FROM packages WHERE skill_id=$1',[skillId]);
    await client.query('DELETE FROM ai_jobs WHERE skill_id=$1',[skillId]);
    await client.query('DELETE FROM community_reviews WHERE skill_id=$1',[skillId]);
    await client.query('DELETE FROM community_moderation WHERE skill_id=$1',[skillId]);
    await client.query('DELETE FROM favorites WHERE skill_id=$1',[skillId]);
    await client.query('DELETE FROM versions WHERE skill_id=$1',[skillId]);
    await client.query('DELETE FROM skills WHERE id=$1',[skillId]);
    await client.query('COMMIT');return {deleted:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function updateSkillMetadata(skillId:string,owner:string,input:Record<string, unknown>) {
  const update=validateMetadataUpdate(input);
  const row=await db().prepare(`SELECT v.version,v.metadata,s.community_version,s.name,s.description,s.category,s.agents,s.tags,s.license FROM skills s JOIN versions v ON v.skill_id=s.id AND v.version=${newestVersion} WHERE s.id=$1 AND s.owner=$2`).bind(skillId,owner).first<{version:string;metadata:string;community_version:string|null;name:string;description:string;category:string;agents:string;tags:string;license:string}>();
  if(!row)throw new ApiError(404,'skill_not_found','技能不存在');
  const published=await db().prepare("SELECT 1 FROM community_reviews WHERE skill_id=$1 AND version=$2 AND (status='approved' OR (status='withdrawn' AND (reviewer IS NOT NULL OR decision_source='ai'))) LIMIT 1").bind(skillId,row.version).first();
  if(row.community_version===row.version||published)throw new ApiError(409,'version_frozen','已通过的展示内容保持不变，请上传新版本');
  const pending=await db().prepare("SELECT 1 FROM community_reviews WHERE skill_id=$1 AND version=$2 AND status='pending' LIMIT 1").bind(skillId,row.version).first();
  if(pending)throw new ApiError(409,'review_pending','该版本正在审核，请先撤回或等待审核完成后再修改资料');
  const metadata=JSON.parse(row.metadata||'{}');
  for(const field of ['name','description','category','agents','tags','license'] as const)if(update[field]!==undefined)metadata[field]=update[field];
  const statements=[db().prepare('UPDATE versions SET metadata=$1 WHERE skill_id=$2 AND version=$3').bind(JSON.stringify(metadata),skillId,row.version),
    db().prepare('UPDATE skills SET name=$1,description=$2,category=$3,agents=$4,tags=$5,license=$6 WHERE id=$7 AND owner=$8').bind(update.name??row.name,update.description??row.description,update.category??row.category,JSON.stringify(update.agents??JSON.parse(row.agents)),JSON.stringify(update.tags??JSON.parse(row.tags)),update.license??row.license,skillId,owner)];
  // Owner edits supersede a previous AI summary for the same fields; the owner may rerun the AI pass afterwards.
  if(update.description!==undefined||update.category!==undefined||update.tags!==undefined)statements.push(db().prepare("UPDATE versions SET ai_status='unprocessed',ai_summary=NULL,ai_category=NULL,ai_tags=NULL WHERE skill_id=$1 AND version=$2").bind(skillId,row.version));
  await db().batch(statements);
  return getSkill(skillId,owner);
}
async function packageInfo(id:string,version:string,markdown:string) {
  const row=await db().prepare('SELECT digest,size,filename,root,files FROM packages WHERE skill_id=$1 AND version=$2').bind(id,version).first<{digest:string;size:number;filename:string;root:string;files:string}>();
  if(row)return {...row,files:JSON.parse(row.files),kind:'uploaded'};
  const bytes=markdownPackage(markdown);return {digest:await digest(bytes),size:bytes.length,filename:id+'.zip',root:'',files:[{path:'SKILL.md',size:new TextEncoder().encode(markdown).length}],kind:'catalog-markdown'};
}
const zipResponse=(bytes:Uint8Array,name:string,hash:string)=>new Response(Uint8Array.from(bytes).buffer,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+name+'"','X-Package-Digest':hash,'ETag':'"'+hash+'"','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
async function skillArtifact(skill:Skill,action:string) {
  if(action==='file')return new Response(skill.markdown,{headers:{'Content-Type':'text/markdown; charset=utf-8','ETag':'"'+skill.digest+'"','X-Skill-Digest':skill.digest,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
  const info=await packageInfo(skill.id,skill.version,skill.markdown);
  if(action==='package')return json({...info,skillId:skill.id,version:skill.version});
  let bytes:Uint8Array;
  if(info.kind==='uploaded') {
    const chunks=await db().prepare('SELECT content FROM package_chunks WHERE skill_id=$1 AND version=$2 ORDER BY chunk_index').bind(skill.id,skill.version).all<{content:number[]}>();
    bytes=new Uint8Array(info.size);let at=0;for(const chunk of chunks.results){const content=new Uint8Array(chunk.content);bytes.set(content,at);at+=content.length;}
    if(at!==info.size||await digest(bytes)!==info.digest)throw new ApiError(500,'package_corrupt','技能包存储校验失败');
  }else bytes=markdownPackage(skill.markdown);
  return zipResponse(bytes,skill.slug+'-'+skill.version+'.zip',info.digest);
}
export async function handle(request: Request) {
  try {
    // Large ZIP uploads must authenticate before their bodies are buffered.
    const first=new URL(request.url).pathname.replace(/^\/api\/v1\/?/,'').split('/').filter(Boolean)[0];
    if(!['auth','health','openapi.json'].includes(first))await identity(request,true);
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
      return json({ status: 'ok', version: '0.7.0', database: 'PostgreSQL' });
    }
    const authResponse=await handleAuth(request,path,body);if(authResponse)return authResponse;
    // The entire registry and board require a CAS session or a user-owned API key.
    const currentUser=(await identity(request,true))!;
    if (method==='GET' && path.length===1 && path[0]==='package-template') {const bytes=packageTemplate();return zipResponse(bytes,'my-skill.zip',await digest(bytes));}
    await seedCatalog();
    if(path[0]==='admin') {
      requireAdmin(currentUser.role);
      if(path[1]==='skills'&&path[2]&&((path.length===4&&path[3]==='community'&&method==='DELETE')||(path.length===5&&path[3]==='community'&&path[4]==='unblock'&&method==='POST'))) {const writer=(await identity(request,true,true))!;const input=await body(request);return json(await moderateCommunity(path[2],writer.userId,method==='DELETE'?'remove':'unblock',input.reason));}
      if(path[1]!=='reviews')throw new ApiError(404,'route_not_found','管理员接口不存在');
      if(method==='GET'&&path.length===2) {
        const status=url.searchParams.get('status')??'pending';
        if(!['pending','approved','rejected','withdrawn','all'].includes(status))throw new ApiError(400,'invalid_status','无效的审核状态');
        const {offset,limit}=messagePagination(url.searchParams),where=status==='all'?'':' WHERE r.status=$1',values=status==='all'?[]:[status];
        const count=await db().prepare('SELECT count(*)::integer AS total FROM community_reviews r'+where).bind(...values).first<{total:number}>();
        const list=await db().prepare(reviewQuery+where+` ORDER BY r.created_at DESC,r.id LIMIT $${values.length+1} OFFSET $${values.length+2}`).bind(...values,limit,offset).all<Review>();
        return json({items:list.results,total:count?.total??0,offset,limit,nextOffset:offset+limit<(count?.total??0)?offset+limit:null});
      }
      if(method==='GET'&&path.length===3) {
        const review=await db().prepare(reviewQuery+' WHERE r.id=$1').bind(path[2]).first<Review>();if(!review)throw new ApiError(404,'review_not_found','审核记录不存在');return json(review);
      }
      if(method==='GET'&&path.length===4&&['skill','file','package','download'].includes(path[3])) {
        const skill=await reviewSkill(path[2]);return path[3]==='skill'?json(skill):skillArtifact(skill,path[3]);
      }
      if(method==='POST'&&path.length===4&&path[3]==='decision') {
        const writer=(await identity(request,true,true))!,input=await body(request);return json(await decideReview(path[2],writer.userId,input.decision,input.reason));
      }
      throw new ApiError(404,'route_not_found','管理员接口不存在');
    }
    if (path[0] === 'messages') {
      if(method==='DELETE'&&path.length===2) {
        const user=(await identity(request,true,true))!;requireAdmin(user.role);
        const result=await db().prepare('UPDATE messages SET deleted_at=now(),deleted_by=$1 WHERE id=$2 AND deleted_at IS NULL').bind(user.userId,path[1]).run();
        if(!result.meta.changes)throw new ApiError(404,'message_not_found','留言不存在');return json({deleted:true});
      }
      if (method === 'GET' && path.length === 1) {
        await identity(request);
        const { offset, limit } = messagePagination(url.searchParams);
        const [count, list] = await Promise.all([
          db().prepare('SELECT count(*)::integer AS total FROM messages WHERE deleted_at IS NULL').first<{total:number}>(),
          db().prepare(messageQuery+' WHERE deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2').bind(limit,offset).all<MessageRow>(),
        ]);
        const total = count?.total ?? 0;
        return json({items:list.results.map(mapMessage),total,offset,limit,nextOffset:offset+limit<total?offset+limit:null});
      }
      if (method === 'GET' && path.length === 2) {
        await identity(request);
        const message = await db().prepare(messageQuery+' WHERE id=$1 AND deleted_at IS NULL').bind(path[1]).first<MessageRow>();
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
      const user=currentUser,list=await allSkills(user.userId),visible=await allSkills(user.userId,'all');
      return json({ agents: AGENTS, categories: CATEGORIES, skillCount: list.length, sourceCount: new Set(list.filter(s => s.source).map(s => s.source)).size, favoriteCount: visible.filter(s => s.favorite).length, workspace: authConfig().mode==='cas'?'cas':'local', loginConfigured:authConfig().mode==='cas',aiEnabled:readAiConfig().enabled, user: user ? { id:user.userId,displayName:user.displayName,email:user.email,scope:user.scope,role:user.role } : null });
    }
    if (path[0] === 'skills' && !path[1] && method === 'GET') {
      const user=currentUser;let list=await allSkills(user.userId,url.searchParams.get('scope')??(url.searchParams.get('favorites')==='true'?'all':'mine'));
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
      const id=path[1],user=currentUser;
      if(method==='POST'&&((path.length===3&&path[2]==='ai')||(path.length===5&&path[2]==='reviews'&&path[4]==='ai-retry'))) {
        const writer=(await identity(request,true,true))!;if(!readAiConfig().enabled)throw new ApiError(503,'ai_disabled','AI 功能尚未启用');
        if(path[2]==='ai') {const input=await body(request);if(input.version!==undefined&&typeof input.version!=='string')throw new ApiError(400,'invalid_version','无效版本');const skill=await getSkill(id,writer.userId,input.version as string|undefined);return json(await retryAi(id,writer.userId,skill.version));}
        const review=await db().prepare('SELECT version FROM community_reviews WHERE id=$1 AND skill_id=$2 AND submitter=$3').bind(path[3],id,writer.userId).first<{version:string}>();if(!review)throw new ApiError(404,'review_not_found','审核记录不存在');return json(await retryAi(id,writer.userId,review.version,path[3]));
      }
      if(path.length===3&&path[2]==='reviews'&&method==='GET') {
        const owned=await db().prepare('SELECT id FROM skills WHERE id=$1 AND owner=$2').bind(id,user.userId).first();if(!owned)throw new ApiError(404,'skill_not_found','技能不存在');
        return json((await db().prepare(reviewQuery+' WHERE r.skill_id=$1 ORDER BY r.created_at DESC').bind(id).all<Review>()).results);
      }
      if(path.length===3&&path[2]==='community'&&['POST','DELETE'].includes(method)) {
        const writer=(await identity(request,true,true))!;
        if(method==='DELETE')return json(await withdrawCommunity(id,writer.userId));
        const owned=await db().prepare('SELECT id,community_blocked FROM skills WHERE id=$1 AND owner=$2').bind(id,writer.userId).first<{id:string;community_blocked:boolean}>();if(!owned)throw new ApiError(404,'skill_not_found','技能不存在');
        if(owned.community_blocked)throw new ApiError(403,'community_blocked','该技能已被管理员下架，请联系管理员解除限制');
        const input=await body(request);if(input.version!==undefined&&typeof input.version!=='string')throw new ApiError(400,'invalid_version','version 必须是字符串');
        if(writer.kind==='local')throw new ApiError(503,'cas_required','社区审核需要公司 CAS 身份');
        const skill=await getSkill(id,writer.userId,input.version as string|undefined),reviewId=crypto.randomUUID();
        const ai=readAiConfig().enabled,statements=[db().prepare("INSERT INTO community_reviews(id,skill_id,version,submitter,ai_status) VALUES($1,$2,$3,$4,$5)").bind(reviewId,id,skill.version,writer.userId,ai?'queued':'not_requested')];
        if(ai) {
          if(skill.aiStatus!=='ready') {
            statements.push(db().prepare("INSERT INTO ai_jobs(id,kind,skill_id,version) VALUES($1,'summary',$2,$3) ON CONFLICT DO NOTHING").bind(crypto.randomUUID(),id,skill.version));
          }
          statements.push(db().prepare("INSERT INTO ai_jobs(id,kind,skill_id,version,review_id) VALUES($1,'review',$2,$3,$4)").bind(crypto.randomUUID(),id,skill.version,reviewId));
        }
        try {await db().batch(statements);}
        catch(error){if((error as {code?:string}).code==='23505')throw new ApiError(409,'review_exists','该版本已待审核或已通过');throw error;}
        return json({id:reviewId,skillId:id,version:skill.version,status:'pending'},201);
      }
      if (method === 'DELETE' && path.length === 2) { const writer=(await identity(request,true,true))!; return json(await deleteSkill(id,writer.userId)); }
      if (method === 'PATCH' && path.length === 2) { const writer=(await identity(request,true,true))!; return json(await updateSkillMetadata(id,writer.userId,await body(request))); }
      if (method === 'GET' && path.length === 2) return json(await getSkill(id,user.userId,url.searchParams.get('version')??undefined));
      if (method === 'GET' && path[2] === 'versions') { const skill=await getSkill(id,user.userId);const result=await db().prepare('SELECT v.version,v.digest,v.changelog,v.created_at,v."commit" FROM versions v JOIN skills s ON s.id=v.skill_id WHERE s.id=$1'+(skill.owner===user.userId?'':` AND ${approvedVersion}`)).bind(id).all<{version:string}>(); return json(result.results.sort((a,b) => compareVersion(b.version,a.version))); }
      if (method==='GET' && path.length===3 && ['file','download','package'].includes(path[2])) {
        return skillArtifact(await getSkill(id,user.userId,url.searchParams.get('version')??undefined),path[2]);
      }
      if (path[2] === 'favorite' && ['PUT','DELETE'].includes(method)) {
        const writer = await identity(request, true, true); await getSkill(id,writer!.userId);
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
