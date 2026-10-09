import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { zipSync,strToU8 } from 'fflate';
import { getPool } from '../db/postgres.mjs';
if(process.env.SKILLHUB_AUTH_TEST_MODE!=='isolated'||process.env.NODE_ENV!=='test'||process.env.SKILLHUB_CAS_BASE_URL!=='http://cas-mock:8123/cas')throw new Error('Run only in dedicated CAS QA project.');
const base='http://127.0.0.1:3356',pool=getPool();let checks=0;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
const jar=()=>new Map();
async function request(path,{cookies,method='GET',body,headers={}}={}) {
  const h=new Headers(headers);
  if(cookies?.size)h.set('Cookie',[...cookies].map(([name,value])=>name+'='+value).join('; '));
  if(body&&!(body instanceof FormData)){h.set('Content-Type','application/json');body=JSON.stringify(body);}
  if(method!=='GET'&&!h.has('Origin'))h.set('Origin',base);
  const response=await fetch(base+'/api/v1/'+path,{method,headers:h,body,redirect:'manual'});
  const sets=response.headers.getSetCookie();
  for(const set of sets){const [pair]=set.split(';'),split=pair.indexOf('=');if(cookies){if(/Max-Age=0(?:;|$)/.test(set))cookies.delete(pair.slice(0,split));else cookies.set(pair.slice(0,split),pair.slice(split+1));}}
  let data=null;
  if(response.headers.get('Content-Type')?.includes('application/json'))data=await response.json();
  return {response,status:response.status,data,sets};
}
const loginAttempt=async cookies=>{
  const r=await request('auth/login',{cookies});check(r.status,302);
  check(new URL(r.response.headers.get('Location')).searchParams.get('service'),base+'/');
  check(r.sets.some(c=>c.includes('HttpOnly')&&c.includes('SameSite=Lax')&&c.includes('Path=/')&&!c.includes('Secure')),true);
};
const exchange=(cookies,ticket,extra={})=>request('auth/cas/exchange',{cookies,method:'POST',body:{ticket,service:base+'/'},...extra});
const login=async (name)=>{
  const cookies=jar();await loginAttempt(cookies);
  const r=await exchange(cookies,'ST-'+name+'-'+randomUUID());check(r.status,200);
  check(r.sets.some(c=>c.startsWith('skillhub_cas_session=')&&c.includes('HttpOnly')&&c.includes('Max-Age=28800')),true);
  return {cookies,user:r.data.data.user};
};
const upload=(id,version='1.0.0')=>{
  const bytes=zipSync({'SKILL.md':strToU8(`---\nname: ${id}\ndescription: A shared CAS integration test skill.\n---\n# Test\n`),'assets/data.txt':strToU8('resource intact')});
  const form=new FormData();form.append('file',new Blob([bytes]),id+'.zip');form.append('version',version);return {form,bytes};
};
try {
  check((await request('auth/me')).data.data.authenticated,false);
  for(const path of ['meta','skills','skills/gsap-react','skills/gsap-react/versions','skills/gsap-react/file','skills/gsap-react/package','skills/gsap-react/download','messages','messages/nonexistent','keys','package-template'])check((await request(path)).status,401);
  for(const [path,method] of [['skills','POST'],['messages','POST'],['skills/gsap-react/favorite','PUT'],['keys','POST'],['keys/x','DELETE']])check((await request(path,{method,body:{}})).status,401);
  check((await request('health')).status,200);check((await request('openapi.json')).status,200);
  const bypass=['http://127.0.0.1:3356.evil.invalid/','http://evil@127.0.0.1:3356/','http://127.0.0.1:3356/other','http://127.0.0.1:3356','http://127.0.0.1:3357/'];
  for(const service of bypass)check((await request('auth/login?service='+encodeURIComponent(service))).status,400);
  const noAttempt=await exchange(jar(),'ST-Alice-'+randomUUID());check(noAttempt.status,401);
  const mismatch=jar();await loginAttempt(mismatch);
  check((await exchange(mismatch,'ST-Alice-'+randomUUID(),{body:{ticket:'ST-Alice-x',service:'http://evil.invalid/'}})).status,400);
  check((await exchange(mismatch,'ST-Alice-'+randomUUID(),{headers:{Origin:'http://evil.invalid'}})).status,403);
  const alice=await login('Alice'),bob=await login('Bob');check(alice.user.id!==bob.user.id,true);
  check((await request('auth/me',{cookies:alice.cookies})).data.data.user.displayName,'用户甲');
  check((await request('meta',{cookies:alice.cookies})).data.data.loginConfigured,true);
  check((await request('skills',{cookies:alice.cookies})).status,200);
  for(const mode of ['Invalid','HTML','XML','DTD','Large','Redirect']) {
    const cookies=jar();await loginAttempt(cookies);check((await exchange(cookies,'ST-'+mode+'-'+randomUUID())).status,mode==='Redirect'?502:401);check((await request('auth/me',{cookies})).data.data.authenticated,false);check((await request('skills',{cookies})).status,401);
  }
  const replay=jar();await loginAttempt(replay);const ticket='ST-Alice-'+randomUUID();check((await exchange(replay,ticket)).status,200);
  check((await exchange(replay,ticket)).status,401);await loginAttempt(replay);check((await exchange(replay,ticket)).status,401);
  const parallel=jar();await loginAttempt(parallel);
  const replies=await Promise.all([exchange(new Map(parallel),'ST-Alice-'+randomUUID()),exchange(new Map(parallel),'ST-Alice-'+randomUUID())]);check(replies.map(r=>r.status).sort(),[200,401]);
  const expiredAttempt=jar();await loginAttempt(expiredAttempt);await pool.query('UPDATE auth_attempts SET expires_at=now()-interval \'1 second\'');check((await exchange(expiredAttempt,'ST-Alice-'+randomUUID())).status,401);
  const id='cas-test-'+randomUUID().slice(0,8),bundle=upload(id);
  const published=await request('skills',{cookies:alice.cookies,method:'POST',body:bundle.form});check(published.status,201);const skillId=published.data.data.id;
  check((await request('skills/'+skillId+'/download',{cookies:bob.cookies})).status,404); // uploads are private until approved
  const bUpdate=upload(id,'1.1.0');bUpdate.form.append('id',skillId);check((await request('skills',{cookies:bob.cookies,method:'POST',body:bUpdate.form})).status,404);
  const downloaded=await request('skills/'+skillId+'/download',{cookies:alice.cookies});check(Buffer.from(await downloaded.response.arrayBuffer()),Buffer.from(bundle.bytes));
  check((await request('skills/'+skillId+'/favorite',{cookies:alice.cookies,method:'PUT'})).status,200);
  check((await request('skills?favorites=true',{cookies:alice.cookies})).data.data.total,1);check((await request('skills?favorites=true&user_id='+encodeURIComponent(alice.user.id),{cookies:bob.cookies})).data.data.total,0);
  const aKey=await request('keys',{cookies:alice.cookies,method:'POST',body:{name:'alice-read',scope:'read'}});check(aKey.status,201);
  check((await request('keys',{cookies:bob.cookies})).data.data.length,0);check((await request('keys/'+aKey.data.data.id,{cookies:bob.cookies,method:'DELETE'})).status,404);
  const bearer={Authorization:'Bearer '+aKey.data.data.token};check((await request('skills',{headers:bearer})).status,200);
  check((await request('messages',{method:'POST',headers:bearer,body:{content:'read cannot write'}})).status,403);check((await request('keys',{headers:bearer})).status,403);
  check((await request('skills',{cookies:alice.cookies,headers:{Authorization:'Bearer sg_invalid'}})).status,401);
  const writeKey=await request('keys',{cookies:bob.cookies,method:'POST',body:{name:'bob-write',scope:'write'}});check(writeKey.status,201);
  const note=await request('messages',{method:'POST',headers:{Authorization:'Bearer '+writeKey.data.data.token},body:{content:'共有便签',author:'用户甲',owner:alice.user.id}});check(note.status,201);
  check((await pool.query('SELECT owner FROM messages WHERE id=$1',[note.data.data.id])).rows[0].owner,bob.user.id);
  check((await request('messages/'+note.data.data.id,{cookies:alice.cookies})).status,200); // board is intentionally shared
  check((await request('messages',{cookies:alice.cookies,method:'POST',body:{content:'csrf'},headers:{Origin:'http://evil.invalid'}})).status,403);
  check((await request('auth/logout',{cookies:alice.cookies,method:'POST',headers:{Origin:'http://evil.invalid'}})).status,403);
  const before=new Map(alice.cookies),logout=await request('auth/logout',{cookies:alice.cookies,method:'POST'});check(logout.status,200);check(logout.data.data.logoutUrl,'http://cas-mock:8123/cas/logout?service='+encodeURIComponent(base+'/'));
  check((await request('skills',{cookies:before})).status,401);check((await request('auth/me',{cookies:alice.cookies})).data.data.authenticated,false);
  // Personal API keys survive logout, and can be revoked only in their owner's session.
  const aliceAgain=await login('Alice');check(aliceAgain.user.id,alice.user.id);check((await request('skills?favorites=true',{cookies:aliceAgain.cookies})).data.data.total,1);
  check((await request('keys/'+aKey.data.data.id,{cookies:aliceAgain.cookies,method:'DELETE'})).status,200);check((await request('skills',{headers:bearer})).status,401);
  await pool.query('UPDATE auth_sessions SET expires_at=now()-interval \'1 second\' WHERE user_id=$1',[bob.user.id]);check((await request('skills',{cookies:bob.cookies})).status,401);check((await request('keys',{cookies:bob.cookies})).status,401);
  await pool.query("INSERT INTO skills(id,slug,name,description,category,agents,tags,source,source_path,license,owner,featured,created_at) VALUES('legacy-hidden','legacy-hidden','legacy-hidden','Historical unclaimed','development','[]','[]','','SKILL.md','MIT','local-workspace',0,'2026-10-09')");
  await pool.query("INSERT INTO versions(skill_id,version,markdown,digest,changelog,created_at) VALUES('legacy-hidden','1.0.0','historical','sha256:x','','2026-10-09')");
  check((await request('skills/legacy-hidden',{cookies:aliceAgain.cookies})).status,404);
  check((await request('skills?q=legacy-hidden',{cookies:aliceAgain.cookies})).data.data.total,0);
  const stored=(await pool.query('SELECT token_hash FROM auth_sessions LIMIT 1')).rows[0].token_hash;check(/^[a-f0-9]{64}$/.test(stored),true);check([...aliceAgain.cookies.values()].includes(stored),false);
  console.log(`CAS_INTEGRATION_PASS ${checks} checks; two simulated accounts; no production data touched.`);
} finally {await pool.end();}
