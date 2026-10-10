import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { zipSync,strToU8 } from 'fflate';
import { getPool } from '../db/postgres.mjs';
if(process.env.NODE_ENV!=='test'||process.env.SKILLHUB_AUTH_TEST_MODE!=='isolated'||process.env.SKILLHUB_CAS_BASE_URL!=='http://cas-mock:8123/cas')throw new Error('Dedicated CAS QA only.');
const base='http://127.0.0.1:3356',pool=getPool();let checks=0;
const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function req(path,{user,method='GET',body,headers={}}={}) {
 const h=new Headers(headers);if(user)h.set('Cookie',[...user.cookies].map(([k,v])=>k+'='+v).join('; '));
 if(method!=='GET'&&!h.has('Origin'))h.set('Origin',base);
 if(body&&!(body instanceof FormData)){h.set('Content-Type','application/json');body=JSON.stringify(body);}
 const response=await fetch(base+'/api/v1/'+path,{method,headers:h,body,redirect:'manual'});
 if(user)for(const set of response.headers.getSetCookie()){const pair=set.split(';')[0],at=pair.indexOf('=');if(set.includes('Max-Age=0'))user.cookies.delete(pair.slice(0,at));else user.cookies.set(pair.slice(0,at),pair.slice(at+1));}
 const json=response.headers.get('Content-Type')?.includes('application/json')?await response.json():null;
 return {status:response.status,response,data:json?.data};
}
async function login(name) {
 const user={cookies:new Map(),id:null};check((await req('auth/login',{user})).status,302);
 const exchange=await req('auth/cas/exchange',{user,method:'POST',body:{ticket:'ST-'+name+'-'+randomUUID(),service:base+'/'}});check(exchange.status,200);user.id=exchange.data.user.id;return user;
}
function bundle(slug,version,description='Private original version content.') {
 const bytes=zipSync({'SKILL.md':strToU8(`---\nname: ${slug}\ndescription: ${description}\n---\n# Version ${version}\nPrivate version body.\n`),'assets/data.txt':strToU8('original resource '+version)}),form=new FormData();
 form.append('file',new Blob([bytes]),slug+'.zip');form.append('version',version);return {form,bytes};
}
const key=async(user,scope='write')=>{const k=await req('keys',{user,method:'POST',body:{name:'qa-'+scope,scope}});check(k.status,201);return {Authorization:'Bearer '+k.data.token};};
try {
 const a=await login('Alice'),b=await login('Bob'),admin=await login('Charlie');
 for(const user of [a,b,admin])check((await req('auth/me',{user})).data.user.role,'user');
 check((await req('admin/reviews',{user:admin})).status,403);
 // The operator CLI is the only supported promotion mechanism; no first-user or browser elevation.
 execFileSync(process.execPath,['scripts/set-role.mjs','--subject','charlie','--role','admin'],{stdio:'ignore'});
 check((await req('auth/me',{user:admin})).data.user.role,'admin');
 check((await req('meta',{user:admin})).data.user.role,'admin');
 const adminAgain=await login('Charlie');check((await req('auth/me',{user:adminAgain})).data.user.role,'admin');
 const slug='community-test-'+randomUUID().slice(0,8),v1=bundle(slug,'1.0.0'),v2=bundle(slug,'2.0.0','Secret unapproved v2 description.');
 const uploaded=await req('skills',{user:a,method:'POST',body:v1.form});check(uploaded.status,201);const id=uploaded.data.id;
 check(uploaded.data.communityVersion,null);check(uploaded.data.slug,slug);check(uploaded.data.owner,a.id);
 const other=await req('skills',{user:b,method:'POST',body:bundle(slug,'1.0.0').form});check(other.status,201);check(other.data.id!==id,true);
 check((await req('skills?q='+slug,{user:a})).data.items.map(s=>s.id),[id]);
 check((await req('skills?q='+slug,{user:b})).data.items.map(s=>s.id),[other.data.id]);
 check((await req('skills?scope=all&q='+slug+'&user_id='+a.id,{user:b})).data.items.map(s=>s.id),[other.data.id]);
 const readA=await key(a,'read'),readB=await key(b,'read'),readAdmin=await key(admin,'read'),writeAdmin=await key(admin);
 const artifacts=['','/versions','/file','/package','/download'];
 for(const user of [b,admin])for(const suffix of artifacts)check((await req('skills/'+id+suffix,{user})).status,404);
 for(const suffix of artifacts)check((await req('skills/'+id+suffix,{headers:readB})).status,404);
 for(const method of ['PUT','DELETE'])check((await req('skills/'+id+'/favorite',{user:b,method})).status,404);
 check((await req('skills/'+id+'/reviews',{user:b})).status,404);
 check((await req('skills?scope=community&q='+slug,{user:b})).data.total,0);
 const stolen=bundle(slug,'1.1.0');stolen.form.append('id',id);stolen.form.append('owner',b.id);stolen.form.append('role','admin');check((await req('skills',{user:b,method:'POST',body:stolen.form})).status,404);
 const submit=async(version)=>req('skills/'+id+'/community',{user:a,method:'POST',body:{version}});
 check((await req('skills/'+id+'/community',{user:b,method:'POST',body:{version:'1.0.0'}})).status,404);
 check((await req('skills/'+id+'/community',{headers:readA,method:'POST',body:{version:'1.0.0'}})).status,403);
 const pending=await submit('1.0.0');check(pending.status,201);const review=pending.data.id;
 check((await submit('1.0.0')).status,409);check((await req('skills/'+id+'/reviews',{user:a})).data[0].status,'pending');
 check((await req('skills?scope=community&q='+slug,{user:a})).data.total,0);
 check((await req('skills/'+id+'/download',{user:b})).status,404);
 check((await req('admin/reviews',{user:b,headers:{'X-Role':'admin','oai-authenticated-user-role':'admin'}})).status,403);
 for(const suffix of ['', '/skill','/file','/package','/download'])check((await req('admin/reviews/'+review+suffix,{user:b})).status,403);
 check((await req('admin/reviews?status=pending',{user:admin})).data.items.some(r=>r.id===review),true);
 check((await req('admin/reviews/'+review+'/skill',{user:admin})).data.version,'1.0.0');
 check(Buffer.from(await (await req('admin/reviews/'+review+'/download',{user:admin})).response.arrayBuffer()),Buffer.from(v1.bytes));
 const updated=await req('skills',{user:a,method:'POST',body:v2.form});check(updated.status,201);check(updated.data.id,id);
 check((await req('admin/reviews/'+review+'/skill',{user:admin})).data.description,'Private original version content.');
 check(Buffer.from(await (await req('admin/reviews/'+review+'/download?version=2.0.0',{user:admin})).response.arrayBuffer()),Buffer.from(v1.bytes));
 check((await req('skills/'+id,{user:admin})).status,404);
 const decide=(reviewId,decision,extra={})=>req('admin/reviews/'+reviewId+'/decision',{user:admin,method:'POST',body:{decision,reason:'QA feedback'},...extra});
 check((await decide(review,'approve',{headers:{Origin:'http://evil.invalid'}})).status,403);
 check((await decide(review,'approve',{user:undefined,headers:readAdmin})).status,403);
 check((await decide(review,'approve',{user:undefined,headers:writeAdmin})).status,200);
 check((await decide(review,'approve')).status,409);
 const community=(await req('skills?scope=community&q='+slug,{user:b})).data.items;check(community.length,1);check(community[0].id,id);check(community[0].version,'1.0.0');check(community[0].description,'Private original version content.');
 check((await req('skills/'+id,{user:b})).data.version,'1.0.0');check((await req('skills/'+id,{user:a})).data.version,'2.0.0');
 check((await req('skills/'+id+'/versions',{user:b})).data.map(v=>v.version),['1.0.0']);
 check((await req('skills/'+id+'/versions',{user:a})).data.map(v=>v.version),['2.0.0','1.0.0']);
 for(const suffix of ['','/file','/package','/download'])check((await req('skills/'+id+suffix+'?version=2.0.0',{user:b})).status,404);
 check(Buffer.from(await (await req('skills/'+id+'/download',{user:b})).response.arrayBuffer()),Buffer.from(v1.bytes));
 const p2=await submit('2.0.0');check(p2.status,201);check((await decide(p2.data.id,'reject')).status,200);
 check((await req('skills/'+id+'/reviews',{user:a})).data[0].reason,'QA feedback');
 check((await req('skills/'+id,{user:b})).data.version,'1.0.0');
 const p3=await submit('2.0.0');check(p3.status,201);check(p3.data.id!==p2.data.id,true);
 const decisions=await Promise.all([decide(p3.data.id,'approve'),decide(p3.data.id,'reject')]);check(decisions.map(r=>r.status).sort(),[200,409]);
 const finalReview=(await req('admin/reviews/'+p3.data.id,{user:admin})).data;
 if(finalReview.status==='rejected'){const retry=await submit('2.0.0');check(retry.status,201);check((await decide(retry.data.id,'approve')).status,200);}
 check((await req('skills/'+id,{user:b})).data.version,'2.0.0');
 check((await req('skills/'+id+'/download?version=1.0.0',{user:b})).status,200);
 const v3=bundle(slug,'3.0.0');check((await req('skills',{user:a,method:'POST',body:v3.form})).status,201);const p4=await submit('3.0.0');check(p4.status,201);
 check((await req('skills/'+id+'/favorite',{user:b,method:'PUT'})).status,200);
 check((await req('skills/'+id+'/community',{user:b,method:'DELETE'})).status,404);
 check((await req('skills/'+id+'/community',{user:a,method:'DELETE'})).status,200);
 check((await decide(p4.data.id,'approve')).status,409);
 check((await req('skills/'+id,{user:b})).status,404);check((await req('skills/'+id+'/download?version=1.0.0',{user:b})).status,404);
 check((await req('skills?scope=community&q='+slug,{user:b})).data.total,0);
 check((await req('skills?favorites=true&q='+slug,{user:b})).data.items.some(s=>s.id===id),false);
 check((await req('skills/'+id,{user:a})).data.version,'3.0.0');
 // PATCH: only the owner may edit display metadata of the latest private version; frozen or pending versions stay immutable.
 check((await req('skills/'+id,{user:b,method:'PATCH',body:{description:'hijack'}})).status,404);
 check((await req('skills/'+id,{headers:readA,method:'PATCH',body:{description:'hijack'}})).status,403);
 check((await req('skills/'+id,{user:a,method:'PATCH',body:{description:'hijack'},headers:{Origin:'http://evil.invalid'}})).status,403);
 check((await req('skills/'+id,{user:a,method:'PATCH',body:{}})).status,400);
 check((await req('skills/'+id,{user:a,method:'PATCH',body:{description:'broken',category:'unknown'}})).status,400);
 await pool.query("UPDATE versions SET ai_status='ready',ai_summary='AI summary',ai_category='design',ai_tags='[\"ai\"]' WHERE skill_id=$1 AND version='3.0.0'",[id]);
 const licenseEdit=await req('skills/'+id,{user:a,method:'PATCH',body:{license:'Apache-2.0'}});
 check(licenseEdit.status,200);check(licenseEdit.data.license,'Apache-2.0');check(licenseEdit.data.description,'AI summary');
 check((await pool.query("SELECT ai_status,ai_summary FROM versions WHERE skill_id=$1 AND version='3.0.0'",[id])).rows[0].ai_status,'ready');
 const edited=await req('skills/'+id,{user:a,method:'PATCH',body:{name:'Edited display name',description:'Edited owner description.',category:'design',agents:['cursor'],tags:['edited']}});
 check(edited.status,200);check(edited.data.name,'Edited display name');check(edited.data.description,'Edited owner description.');check(edited.data.category,'design');check(edited.data.version,'3.0.0');check(edited.data.slug,slug);
 check(Buffer.from(await (await req('skills/'+id+'/download?version=3.0.0',{user:a})).response.arrayBuffer()),Buffer.from(v3.bytes));
 const storedMeta=(await pool.query("SELECT metadata::json->>'name' AS name,metadata::json->>'sourcePath' AS path FROM versions WHERE skill_id=$1 AND version='3.0.0'",[id])).rows[0];
 check(storedMeta.name,'Edited display name');check(storedMeta.path,'SKILL.md');
 const reset=(await pool.query("SELECT ai_status,ai_summary FROM versions WHERE skill_id=$1 AND version='3.0.0'",[id])).rows[0];
 check(reset.ai_status,'unprocessed');check(reset.ai_summary,null);
 const p5=await submit('3.0.0');check(p5.status,201);
 check((await req('skills/'+id,{user:a,method:'PATCH',body:{description:'mid-review edit'}})).status,409);
 check((await req('skills/'+id+'/community',{user:a,method:'DELETE'})).status,200);
 const v4=bundle(slug,'4.0.0');check((await req('skills',{user:a,method:'POST',body:v4.form})).status,201);
 const p6=await submit('4.0.0');check(p6.status,201);check((await decide(p6.data.id,'approve')).status,200);
 check((await req('skills/'+id,{user:b})).data.version,'4.0.0');
 check((await req('skills/'+id,{user:a,method:'PATCH',body:{description:'post-approval edit'}})).status,409);
 // DELETE: hard-removes the owner's whole skill; non-owners and admins get 404, read keys 403.
 check((await req('skills/'+id,{user:b,method:'DELETE'})).status,404);
 check((await req('skills/'+id,{headers:readA,method:'DELETE'})).status,403);
 check((await req('skills/'+id,{user:admin,method:'DELETE'})).status,404);
 check((await req('skills/'+id,{user:a,method:'DELETE'})).status,200);
 for(const suffix of ['','/versions','/file','/package','/download'])check((await req('skills/'+id+suffix,{user:a})).status,404);
 check((await req('skills?scope=community&q='+slug,{user:b})).data.total,0);
 check((await req('skills?favorites=true',{user:b})).data.items.some(s=>s.id===id),false);
 for(const table of ['skills','versions','packages','package_chunks','community_reviews','ai_jobs','favorites'])check((await pool.query('SELECT count(*)::integer AS n FROM '+table+' WHERE skill_id=$1',[id])).rows[0].n,0);
 check((await req('skills/'+other.data.id,{user:b,method:'DELETE'})).status,200);
 check((await req('skills/'+other.data.id,{user:b})).status,404);
 const note=await req('messages',{user:a,method:'POST',body:{content:'QA deletable note',author:'QA'}});check(note.status,201);const noteId=note.data.id;
 for(const user of [a,b])check((await req('messages/'+noteId,{user,method:'DELETE'})).status,403);
 check((await req('messages/'+noteId,{headers:readAdmin,method:'DELETE'})).status,403);
 check((await req('messages/'+noteId,{user:admin,method:'DELETE',headers:{Origin:'http://evil.invalid'}})).status,403);
 check((await req('messages/'+noteId,{headers:writeAdmin,method:'DELETE'})).status,200);
 for(const user of [a,b,admin])check((await req('messages/'+noteId,{user})).status,404);
 check((await req('messages?limit=100',{user:a})).data.items.some(n=>n.id===noteId),false);
 const deleted=(await pool.query('SELECT deleted_at,deleted_by FROM messages WHERE id=$1',[noteId])).rows[0];check(!!deleted.deleted_at,true);check(deleted.deleted_by,admin.id);
 check((await req('messages/'+noteId,{user:admin,method:'DELETE'})).status,404);
 execFileSync(process.execPath,['scripts/set-role.mjs','--subject','charlie','--role','user'],{stdio:'ignore'});
 check((await req('auth/me',{user:admin})).data.user.role,'user');check((await req('admin/reviews',{user:admin})).status,403);check((await req('admin/reviews',{headers:writeAdmin})).status,403);
 check((await req('messages/'+noteId,{headers:writeAdmin,method:'DELETE'})).status,403);
 check((await req('auth/me',{user:await login('Charlie')})).data.user.role,'user');
 const before=(await pool.query('SELECT role FROM auth_users WHERE id=$1',[b.id])).rows[0].role;
 check((await req('admin/users',{user:b,method:'POST',body:{role:'admin',id:b.id}})).status,403);
 check((await pool.query('SELECT role FROM auth_users WHERE id=$1',[b.id])).rows[0].role,before);
 console.log(`COMMUNITY_INTEGRATION_PASS ${checks} checks; three simulated accounts; private artifacts, frozen review, metadata edits, skill deletion, role revocation and note deletion verified.`);
}finally{await pool.end();}
