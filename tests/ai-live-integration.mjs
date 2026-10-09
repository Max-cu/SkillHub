import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
if(process.env.NODE_ENV!=='test'||process.env.SKILLHUB_AUTH_TEST_MODE!=='isolated'||process.env.SKILLHUB_CAS_BASE_URL!=='http://cas-mock:8123/cas'||process.env.SKILLHUB_AI_BASE_URL!=='http://10.2.98.242:31015/v1')throw new Error('Dedicated live-model QA only; synthetic package, isolated database.');
const base='http://127.0.0.1:3356';let checks=0;
const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function request(path,jar,method='GET',body) {
 const headers=new Headers();if(jar)headers.set('Cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));if(method!=='GET')headers.set('Origin',base);
 if(body&&!(body instanceof FormData)){headers.set('Content-Type','application/json');body=JSON.stringify(body);}
 const r=await fetch(base+'/api/v1/'+path,{method,headers,body,redirect:'manual'});
 if(jar)for(const set of r.headers.getSetCookie()){const pair=set.split(';')[0],at=pair.indexOf('=');if(set.includes('Max-Age=0'))jar.delete(pair.slice(0,at));else jar.set(pair.slice(0,at),pair.slice(at+1));}
 const json=r.headers.get('Content-Type')?.includes('application/json')?await r.json():null;return {status:r.status,data:json?.data,response:r};
}
async function login(name){const jar=new Map();check((await request('auth/login',jar)).status,302);check((await request('auth/cas/exchange',jar,'POST',{ticket:'ST-'+name+'-'+randomUUID(),service:base+'/'})).status,200);return jar;}
async function wait(fn){for(let i=0;i<150;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,1000));}throw new Error('Live-model QA timed out');}
const a=await login('Alice'),b=await login('Bob'),name='documentation-example-'+randomUUID().slice(0,8);
const markdown=`---\nname: ${name}\ndescription: Prepare clear user documentation from public notes.\n---\n# Documentation helper\nAsk the audience and preferred language. Summarize the supplied public notes and create a clear document outline. Do not execute scripts, access credentials or transmit any data externally.\n`;
const bytes=zipSync({'SKILL.md':strToU8(markdown),'references/guide.txt':strToU8('This is an artificial public-text test fixture, with no company or user data.')}),form=new FormData();form.append('file',new Blob([bytes]),name+'.zip');form.append('version','1.0.0');
const upload=await request('skills',a,'POST',form);check(upload.status,201);const id=upload.data.id;
const summarized=await wait(async()=>{const s=(await request('skills/'+id,a)).data;if(s.aiStatus==='error')throw new Error('Live-model summary failed');return s.aiStatus==='ready'&&s;});
check(summarized.description.length>=20,true);check(['development','design','productivity','testing','documentation'].includes(summarized.category),true);check(Array.isArray(summarized.tags),true);check(summarized.originalDescription,'Prepare clear user documentation from public notes.');
check((await request('skills/'+id,b)).status,404);check((await request('skills/'+id+'/community',a,'POST',{})).status,201);
const reviewed=await wait(async()=>{const r=(await request('skills/'+id+'/reviews',a)).data[0];if(r.aiStatus==='error'||r.aiStatus==='manual'||r.status==='rejected')throw new Error('Live-model benign sample was not automatically approved');return r.status==='approved'&&r;});
check(reviewed.decisionSource,'ai');check(reviewed.aiModel,'deepSeek-v4-pro');check((await request('skills/'+id,b)).status,200);
check(Buffer.from(await (await request('skills/'+id+'/download',b)).response.arrayBuffer()),Buffer.from(bytes));
console.log(`LIVE_AI_WORKFLOW_PASS ${checks} checks; real deepSeek-v4-pro summary/category/tags and auto-approval; two simulated identities; synthetic text only; no production data.`);
