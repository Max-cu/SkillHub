import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { zipSync,strToU8 } from 'fflate';
import { getPool } from '../db/postgres.mjs';
if(process.env.NODE_ENV!=='test'||process.env.SKILLHUB_AUTH_TEST_MODE!=='isolated'||process.env.SKILLHUB_AI_BASE_URL!=='http://ai-mock:8124/v1')throw new Error('Isolated AI QA only.');
const pool=getPool(),base='http://127.0.0.1:3356';let checks=0;
const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function request(path,user,method='GET',body) {
 const headers=new Headers();if(user)headers.set('Cookie',[...user.cookies].map(([k,v])=>k+'='+v).join('; '));
 if(method!=='GET')headers.set('Origin',base);
 if(body&&!(body instanceof FormData)){headers.set('Content-Type','application/json');body=JSON.stringify(body);}
 const response=await fetch(base+'/api/v1/'+path,{method,headers,body,redirect:'manual'});
 if(user)for(const set of response.headers.getSetCookie()){const pair=set.split(';')[0],at=pair.indexOf('=');if(set.includes('Max-Age=0'))user.cookies.delete(pair.slice(0,at));else user.cookies.set(pair.slice(0,at),pair.slice(at+1));}
 const json=response.headers.get('Content-Type')?.includes('application/json')?await response.json():null;return {status:response.status,data:json?.data,response};
}
async function login(name){const user={cookies:new Map()};check((await request('auth/login',user)).status,302);const r=await request('auth/cas/exchange',user,'POST',{ticket:'ST-'+name+'-'+randomUUID(),service:base+'/'});check(r.status,200);user.id=r.data.user.id;return user;}
async function wait(predicate){for(let i=0;i<100;i++){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,300));}throw new Error('AI QA wait timed out');}
function archive(marker,version='1.0.0',name='ai-test-'+randomUUID().slice(0,8)) {
 const bytes=zipSync({'SKILL.md':strToU8(`---\nname: ${name}\ndescription: Original private skill description.\n---\n# Test\n${marker}\n`),'references/guide.txt':strToU8('Original auxiliary resource, never execute.')});
 const form=new FormData();form.append('file',new Blob([bytes]),name+'.zip');form.append('version',version);return {bytes,form,name};
}
try {
 const a=await login('Alice'),b=await login('Bob'),admin=await login('Charlie');execFileSync(process.execPath,['scripts/set-role.mjs','--subject','charlie','--role','admin'],{stdio:'ignore'});
 check((await request('meta',a)).data.aiEnabled,true);
 async function upload(marker){const bundle=archive(marker),r=await request('skills',a,'POST',bundle.form);check(r.status,201);const id=r.data.id;await wait(async()=>{const s=(await request('skills/'+id,a)).data;return s.aiStatus==='ready'&&s;});return {id,bundle};}
 const good=await upload('Normal documentation automation.'),skill=(await request('skills/'+good.id,a)).data;
 check(skill.category,'productivity');check(skill.tags,['效率','知识整理']);check(skill.originalDescription,'Original private skill description.');check(skill.description.includes('企业内部'),true);
 check(Buffer.from(await (await request('skills/'+good.id+'/download',a)).response.arrayBuffer()),Buffer.from(good.bundle.bytes));
 check((await request('skills/'+good.id,b)).status,404);
 const submitted=await request('skills/'+good.id+'/community',a,'POST',{version:'1.0.0'});check(submitted.status,201);const reviewId=submitted.data.id;
 const approved=await wait(async()=>{const rows=(await request('skills/'+good.id+'/reviews',a)).data;return rows[0].status==='approved'&&rows[0];});
 check(approved.decisionSource,'ai');check(approved.aiModel,'qwen3.5');check((await request('skills/'+good.id,b)).status,200);
 const review=(await pool.query('SELECT reviewer,package_digest,ai_report FROM community_reviews WHERE id=$1',[reviewId])).rows[0];check(review.reviewer,null);check(review.package_digest.startsWith('sha256:'),true);check(JSON.parse(review.ai_report).decision,'approve');
 check((await request('skills/'+good.id+'/ai',a,'POST',{version:'1.0.0'})).status,409);
 check((await request('admin/skills/'+good.id+'/community',b,'DELETE',{reason:'spoof'})).status,403);
 check((await request('admin/skills/'+good.id+'/community',admin,'DELETE',{reason:'QA moderation'})).status,200);
 check((await request('skills/'+good.id,b)).status,404);check((await request('skills/'+good.id,a)).status,200);check((await request('skills/'+good.id,a)).data.communityBlocked,true);
 check((await request('skills/'+good.id+'/community',a,'POST',{version:'1.0.0'})).status,403);
 check((await pool.query('SELECT actor,reason FROM community_moderation WHERE skill_id=$1',[good.id])).rows[0].actor,admin.id);
 check((await request('admin/skills/'+good.id+'/community/unblock',admin,'POST',{reason:'QA fix confirmed'})).status,200);
 check((await request('skills/'+good.id,b)).status,404);check((await request('skills/'+good.id+'/community',a,'POST',{version:'1.0.0'})).status,201);
 await wait(async()=>(await request('skills/'+good.id,b)).status===200);
 for(const [marker,target] of [['QA_AI_REJECT','rejected'],['QA_AI_MANUAL','pending'],['QA_AI_INVALID','pending']]) {
  const sample=await upload(marker);check((await request('skills/'+sample.id+'/community',a,'POST',{})).status,201);
  const finished=await wait(async()=>{const r=(await request('skills/'+sample.id+'/reviews',a)).data[0];return (r.aiStatus==='done'||r.aiStatus==='manual'||r.aiStatus==='error')&&r;});
  check(finished.status,target);check((await request('skills/'+sample.id,b)).status,404);
 }
 const failed=await upload('QA_AI_FAIL');check((await request('skills/'+failed.id+'/community',a,'POST',{})).status,201);
 const errorReview=await wait(async()=>{const r=(await request('skills/'+failed.id+'/reviews',a)).data[0];return r.aiStatus==='error'&&r;});check(errorReview.status,'pending');check((await request('skills/'+failed.id,b)).status,404);
 await fetch('http://ai-mock:8124/recover');check((await request('skills/'+failed.id+'/reviews/'+errorReview.id+'/ai-retry',b,'POST')).status,404);check((await request('skills/'+failed.id+'/reviews/'+errorReview.id+'/ai-retry',a,'POST')).status,200);
 await wait(async()=>(await request('skills/'+failed.id,b)).status===200);
 const delayed=await upload('QA_AI_DELAY');const pending=await request('skills/'+delayed.id+'/community',a,'POST',{});check(pending.status,201);
 await wait(async()=>(await request('skills/'+delayed.id+'/reviews',a)).data[0].aiStatus==='running');
 check((await request('admin/reviews/'+pending.data.id+'/decision',admin,'POST',{decision:'reject',reason:'Manual override should win.'})).status,200);
 await new Promise(r=>setTimeout(r,3500));check((await request('skills/'+delayed.id+'/reviews',a)).data[0].status,'rejected');check((await request('skills/'+delayed.id,b)).status,404);
 const cancelled=await upload('QA_AI_DELAY');check((await request('skills/'+cancelled.id+'/community',a,'POST',{})).status,201);
 await wait(async()=>(await request('skills/'+cancelled.id+'/reviews',a)).data[0].aiStatus==='running');check((await request('skills/'+cancelled.id+'/community',a,'DELETE')).status,200);
 await new Promise(r=>setTimeout(r,3500));check((await request('skills/'+cancelled.id,b)).status,404);
 const v2=archive('Private new version.','2.0.0',good.bundle.name);check((await request('skills',a,'POST',v2.form)).status,201);await wait(async()=>(await request('skills/'+good.id,a)).data.aiStatus==='ready');
 check((await request('skills/'+good.id,b)).data.version,'1.0.0');check((await request('skills/'+good.id+'/download?version=2.0.0',b)).status,404);
 check((await request('admin/skills/'+good.id+'/community',admin,'DELETE',{reason:'QA block'})).status,200);
 const recovered=await upload('QA_AI_DELAY');const recoveryReview=await request('skills/'+recovered.id+'/community',a,'POST',{});check(recoveryReview.status,201);
 await wait(async()=>(await request('skills/'+recovered.id+'/reviews',a)).data[0].aiStatus==='running');
 await pool.query("UPDATE ai_jobs SET claim_token='qa-expired-lease',lease_until=now()-interval '1 second' WHERE review_id=$1 AND status='running'",[recoveryReview.data.id]);
 await wait(async()=>(await request('skills/'+recovered.id,b)).status===200);
 check((await pool.query('SELECT attempts FROM ai_jobs WHERE review_id=$1',[recoveryReview.data.id])).rows[0].attempts>=2,true);
 console.log(`AI_INTEGRATION_PASS ${checks} checks; summary/category/tags, original ZIP, auto approval, failure fallback, moderation and stale result cancellation verified.`);
}finally{await pool.end();}
