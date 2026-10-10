import { randomBytes, createHash } from 'node:crypto';
import { getDb } from '../db/index';
import { ApiError } from './domain';
import { readAuthConfig } from './cas-config.mjs';
import { validateCasTicket, validateTicketInput } from './cas-protocol';
import { enforceRateLimit, RATE_RULES, clientKey } from './rate-limit';

export type SessionUser={userId:string;displayName:string;role:'user'|'admin';scope:'write';kind:'session'};
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function authConfig() {try{return readAuthConfig();}catch{throw new ApiError(503,'auth_unavailable','SkillHub 登录配置暂不可用');}}
const names=(secure:boolean)=>({session:secure?'__Host-skillhub_session':'skillhub_cas_session',attempt:secure?'__Host-skillhub_login':'skillhub_cas_login'});
function cookie(request:Request,name:string) {
  const matches=(request.headers.get('cookie')??'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(name+'='));
  if(matches.length!==1)return null;
  const value=matches[0].slice(name.length+1);return /^[a-f0-9]{64}$/.test(value)?value:null;
}
const cookieValue=(name:string,token:string,seconds:number,secure:boolean)=>`${name}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${secure?'; Secure':''}`;
function response(data:unknown,status=200,cookies:string[]=[]) {
  const headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  for(const value of cookies)headers.append('Set-Cookie',value);
  return Response.json({data},{status,headers});
}
export function checkBrowserMutation(request:Request,canonicalOrigin?:string,requireOrigin=false) {
  const expected=canonicalOrigin??new URL(request.url).origin,origin=request.headers.get('origin');
  if((requireOrigin&&!origin)||(origin&&origin!==expected)||request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'origin_mismatch','请求必须来自 SkillHub 本站');
}
export async function sessionIdentity(request:Request):Promise<SessionUser|null> {
  const config=authConfig();if(config.mode!=='cas')return null;
  const token=cookie(request,names(config.secure).session);if(!token)return null;
  const row=await getDb().prepare('SELECT u.id,u.display_name,u.role FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()').bind(hash(token)).first<{id:string;display_name:string;role:'user'|'admin'}>();
  return row?{userId:row.id,displayName:row.display_name,role:row.role,scope:'write',kind:'session'}:null;
}
export async function handleAuth(request:Request,path:string[],parseBody:(r:Request)=>Promise<Record<string,unknown>>):Promise<Response|null> {
  if(path[0]!=='auth')return null;
  const config=authConfig(),route=path.slice(1).join('/'),method=request.method;
  if(route==='me'&&method==='GET') {
    if(config.mode==='local')return response({authenticated:true,loginConfigured:false,user:{id:'local-workspace',displayName:'本地工作区',role:'user'},service:null});
    const user=await sessionIdentity(request);
    return response({authenticated:!!user,loginConfigured:true,user:user?{id:user.userId,displayName:user.displayName,role:user.role}:null,service:config.service});
  }
  if(config.mode!=='cas')throw new ApiError(404,'auth_disabled','本地测试模式未启用 CAS');
  // Reverse-proxy headers cannot widen the registered service.
  if(new URL(request.url).origin!==new URL(config.service).origin)throw new ApiError(400,'service_mismatch','请使用已登记的 SkillHub 地址登录');
  const cookies=names(config.secure),db=getDb();
  if(route==='login'&&method==='GET') {
    enforceRateLimit(RATE_RULES.authAttempt,[clientKey(request)]);
    const supplied=new URL(request.url).searchParams.get('service');
    if(supplied!==null&&supplied!==config.service)throw new ApiError(400,'service_mismatch','登录回调地址不匹配');
    const token=randomBytes(32).toString('hex');
    await db.prepare('DELETE FROM auth_attempts WHERE expires_at<=now()').run();
    await db.prepare('INSERT INTO auth_attempts(token_hash,expires_at) VALUES($1,now()+interval \'10 minutes\')').bind(hash(token)).run();
    const url=new URL(config.base+'/login');url.searchParams.set('service',config.service);
    return new Response(null,{status:302,headers:{Location:url.href,'Set-Cookie':cookieValue(cookies.attempt,token,600,config.secure),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if(route==='cas/exchange'&&method==='POST') {
    enforceRateLimit(RATE_RULES.authExchange,[clientKey(request)]);
    checkBrowserMutation(request,new URL(config.service).origin,true);
    const input=await parseBody(request),ticket=validateTicketInput(input.ticket);
    if(input.service!==config.service)throw new ApiError(400,'service_mismatch','票据回调地址不匹配');
    const attempt=cookie(request,cookies.attempt);if(!attempt)throw new ApiError(401,'login_required','请从 SkillHub 登录入口重新登录');
    const claim=await db.prepare('DELETE FROM auth_attempts WHERE token_hash=$1 AND expires_at>now() RETURNING token_hash').bind(hash(attempt)).first();
    if(!claim)throw new ApiError(401,'login_expired','登录已过期或票据已使用，请重新登录');
    await db.prepare('DELETE FROM auth_tickets WHERE expires_at<=now()').run();
    const fresh=await db.prepare('INSERT INTO auth_tickets(ticket_hash,expires_at) VALUES($1,now()+interval \'24 hours\') ON CONFLICT DO NOTHING RETURNING ticket_hash').bind(hash(ticket)).first();
    if(!fresh)throw new ApiError(401,'ticket_replayed','票据已使用，请重新登录');
    const verified=await validateCasTicket(ticket,config.service,config.base),userId='cas:'+hash(verified.subject),token=randomBytes(32).toString('hex');
    await db.batch([
      db.prepare('DELETE FROM auth_sessions WHERE expires_at<=now()'),
      db.prepare('INSERT INTO auth_users(id,cas_subject,display_name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,updated_at=now()').bind(userId,verified.subject,verified.displayName),
      db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3*interval \'1 second\')').bind(hash(token),userId,config.ttl),
    ]);
    return response({authenticated:true,user:{id:userId,displayName:verified.displayName}},200,[cookieValue(cookies.session,token,config.ttl,config.secure),cookieValue(cookies.attempt,'',0,config.secure)]);
  }
  if(route==='logout'&&method==='POST') {
    checkBrowserMutation(request,new URL(config.service).origin,true);
    const token=cookie(request,cookies.session),attempt=cookie(request,cookies.attempt);
    if(token)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=$1').bind(hash(token)).run();
    if(attempt)await db.prepare('DELETE FROM auth_attempts WHERE token_hash=$1').bind(hash(attempt)).run();
    const logout=new URL(config.base+'/logout');logout.searchParams.set('service',config.service);
    return response({logoutUrl:logout.href},200,[cookieValue(cookies.session,'',0,config.secure),cookieValue(cookies.attempt,'',0,config.secure)]);
  }
  throw new ApiError(404,'route_not_found','认证接口不存在');
}
