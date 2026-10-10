import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { zipSync,strToU8 } from 'fflate';
import { readAiConfig,parseAiResult,inspectAiArchive,callAi } from '../lib/ai-service.mjs';
test('AI endpoint is operator configured and disabled until enabled',()=>{
 assert.equal(readAiConfig({}).enabled,false);
 const env={SKILLHUB_AI_ENABLED:'true',SKILLHUB_AI_BASE_URL:'http://10.2.98.250:8010/v1',SKILLHUB_AI_MODEL:'qwen3.5'};
 assert.equal(readAiConfig(env).model,'qwen3.5');
 for(const base of ['http://user:secret@localhost/v1','file:///v1','http://host/v1?target=x','http://host/other'])assert.throws(()=>readAiConfig({...env,SKILLHUB_AI_BASE_URL:base}));
});
test('AI outputs must have complete bounded enum-based schemas',()=>{
 assert.deepEqual(parseAiResult('{"decision":"approve","reason":"用途合理，内容完整且未发现明显违规。"}','review').decision,'approve');
 for(const raw of ['yes','{"decision":"approve"}','{"decision":"approve","reason":"abcde","skill_id":"other"}','{"decision":"approve","reason":true}','{"decision":"PASS","reason":"valid reason"}'])assert.throws(()=>parseAiResult(raw,'review'));
 assert.throws(()=>parseAiResult('{"summary":"abcdefghijklmnopqrst","category":"root","tags":[]}','summary'));
 assert.equal(parseAiResult('```json\n{"summary":"这是一项用于自动整理企业内部资料的文档技能，适合撰写工作说明。","category":"documentation","tags":["文档"]}\n```','summary').category,'documentation');
});
test('AI archive extraction binds the exact digest; inert binary assets stay reviewable while unknown binaries defer to a human',()=>{
 const inert=zipSync({'SKILL.md':strToU8('Full instructions'),'scripts/run.py':strToU8('print("test")'),'assets/logo.png':new Uint8Array([137,80,78,71,13,10,26,10])});
 const digest='sha256:'+createHash('sha256').update(inert).digest('hex');
 const input=inspectAiArchive(inert,digest);assert.equal(input.complete,true);assert.equal(input.texts.length,2);assert.equal(input.files.length,3);
 assert.deepEqual(input.binaryAssets,[{path:'assets/logo.png',size:8}]);
 assert.throws(()=>inspectAiArchive(inert,'sha256:wrong'));
 const unknown=zipSync({'SKILL.md':strToU8('Full instructions'),'payload.bin':new Uint8Array([0,255])});
 const unknownDigest='sha256:'+createHash('sha256').update(unknown).digest('hex');
 assert.equal(inspectAiArchive(unknown,unknownDigest).complete,false);
});
test('AI reads nested case-insensitive skill entry before large resources, within a separate input budget',()=>{
 const bytes=zipSync({'assets/large.bin':new Uint8Array(6*1024*1024),'repo/skills/docs/sKiLl.Md':strToU8('# Actual instructions\n\nPrepare documentation from public notes.')},{level:0});
 const digest='sha256:'+createHash('sha256').update(bytes).digest('hex'),input=inspectAiArchive(bytes,digest);
 assert.equal(input.complete,false);assert.equal(input.texts[0].path,'repo/skills/docs/sKiLl.Md');assert.equal(input.files.find(f=>f.path==='assets/large.bin')?.size,6*1024*1024);
});
test('A ZIP decoder omitted resource is never reported as fully reviewed',()=>{
 const bytes=zipSync({'SKILL.md':strToU8('# Public instructions'),'safe-file':strToU8('Auxiliary instructions')},{level:0});
 const from=Buffer.from('safe-file'),to=Buffer.from('__proto__');
 for(let i=0;i<bytes.length-from.length;i++)if(from.every((b,j)=>bytes[i+j]===b)){bytes.set(to,i);i+=from.length-1;}
 const hash='sha256:'+createHash('sha256').update(bytes).digest('hex');assert.equal(inspectAiArchive(bytes,hash).complete,false);
});
test('AI calls never follow redirects or accept truncated/invalid success bodies',async()=>{
 const config=readAiConfig({SKILLHUB_AI_ENABLED:'true',SKILLHUB_AI_BASE_URL:'http://ai-mock:8124/v1',SKILLHUB_AI_MODEL:'qwen3.5'});
 const valid={choices:[{finish_reason:'stop',message:{content:'{"decision":"approve","reason":"内容用途明确且未发现不合规行为。"}'}}]};
 assert.equal((await callAi(config,'review',{texts:[]},async(url,options)=>{assert.equal(url,'http://ai-mock:8124/v1/chat/completions');assert.ok(options);assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body as string).tools,undefined);return Response.json(valid);})).decision,'approve');
 await assert.rejects(callAi(config,'review',{},async()=>Response.json({...valid,choices:[{...valid.choices[0],finish_reason:'length'}]})));
 await assert.rejects(callAi(config,'review',{},async()=>new Response('bad gateway',{status:502})));
});
