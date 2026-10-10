import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
if(process.env.NODE_ENV!=='test'||process.env.SKILLHUB_AUTH_TEST_MODE!=='isolated'||process.env.SKILLHUB_CAS_BASE_URL!=='http://cas-mock:8123/cas'||process.env.SKILLHUB_AI_ENABLED==='true')throw new Error('Run only with AI disabled in isolated CAS QA.');
const base='http://127.0.0.1:3356';let checks=0;
const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function request(path,user,method='GET',body) {
 const headers=new Headers();if(user)headers.set('Cookie',[...user].map(([k,v])=>k+'='+v).join('; '));if(method!=='GET')headers.set('Origin',base);
 if(body&&!(body instanceof FormData)){headers.set('Content-Type','application/json');body=JSON.stringify(body);}
 const response=await fetch(base+'/api/v1/'+path,{method,headers,body,redirect:'manual'});
 if(user)for(const set of response.headers.getSetCookie()){const pair=set.split(';')[0],at=pair.indexOf('=');if(set.includes('Max-Age=0'))user.delete(pair.slice(0,at));else user.set(pair.slice(0,at),pair.slice(at+1));}
 const json=response.headers.get('Content-Type')?.includes('application/json')?await response.json():null;return {status:response.status,response,data:json?.data};
}
async function login(name){const jar=new Map();check((await request('auth/login',jar)).status,302);check((await request('auth/cas/exchange',jar,'POST',{ticket:'ST-'+name+'-'+randomUUID(),service:base+'/'})).status,200);return jar;}
const a=await login('Alice'),b=await login('Bob'),admin=await login('Charlie');
execFileSync(process.execPath,['scripts/set-role.mjs','--subject','charlie','--role','admin'],{stdio:'ignore'});
const fixtures=JSON.parse(readFileSync('/tmp/compat-fixtures.json','utf8'));let standardId;
const form=(f,version)=>{const data=new FormData();data.append('file',new Blob([Buffer.from(f.content,'base64')]),f.name+'.zip');data.append('id','compat-'+f.name);if(version)data.append('version',version);return data;};
for(const fixture of fixtures) {
 const created=await request('skills',a,'POST',form(fixture));check(created.status,201);const id=created.data.id;
 check(created.data.version,'0.1.0');check((await request('skills/'+id,b)).status,404);
 check(Buffer.from(await (await request('skills/'+id+'/download',a)).response.arrayBuffer()),Buffer.from(fixture.content,'base64'));
 check((await request('skills/'+id+'/package',a)).data.size,fixture.bytes);
 if(fixture.name==='no-frontmatter')check(created.data.importWarnings.length>0,true);
 if(fixture.name==='unicode-short-metadata')check(created.data.name,'天辰_报表 Skill');
 if(fixture.name==='standard')standardId=id;
}
const fixture=fixtures.find(f=>f.name==='standard');
const second=await request('skills',a,'POST',form(fixture));check(second.status,201);check(second.data.id,standardId);check(second.data.version,'0.1.1');
check((await request('skills',a,'POST',form(fixture,'0.1.0'))).status,409);
check((await request('skills/'+standardId+'/versions',a)).data.slice(0,2).map(v=>v.version),['0.1.1','0.1.0']);
const submitted=await request('skills/'+standardId+'/community',a,'POST',{version:'0.1.0'});check(submitted.status,201);
check((await request('admin/reviews/'+submitted.data.id+'/decision',admin,'POST',{decision:'approve',reason:'Synthetic compatible ZIP verified.'})).status,200);
const third=await request('skills',a,'POST',form(fixture));check(third.status,201);check(third.data.version,'0.1.2');
check((await request('skills/'+standardId,b)).data.version,'0.1.0');check((await request('skills/'+standardId+'/download?version=0.1.2',b)).status,404);
check(Buffer.from(await (await request('skills/'+standardId+'/download?version=0.1.0',b)).response.arrayBuffer()),Buffer.from(fixture.content,'base64'));
console.log(`UPLOAD_COMPAT_INTEGRATION_PASS ${checks} checks; nine SkillGo-accepted synthetic ZIPs; exact download bytes; automatic version increment; private/new version isolation.`);
