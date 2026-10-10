import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { ApiError, compareVersion, digest, parseSkill, validatePublish, validateMetadataUpdate } from '../lib/domain.ts';
import { inspectPackage, MAX_ZIP_BYTES, packageTemplate } from '../lib/package.ts';
import { MAX_EXPANDED_BYTES,MAX_FILES } from '../lib/package-limits.mjs';
const markdown='---\nname: useful-skill\ndescription: A useful task workflow.\n---\n\n# Workflow\nComplete and verify the task.';
const publish={markdown,version:'1.0.0',category:'development',agents:['codex'],license:'MIT'};
const zip=(files:Record<string,Uint8Array>={'SKILL.md':strToU8(markdown)})=>zipSync(files,{level:6});
const central=(bytes:Uint8Array)=>new DataView(bytes.buffer).getUint32(bytes.length-6,true);
const reject=(bytes:Uint8Array)=>assert.throws(()=>inspectPackage(bytes),ApiError);

test('Standard frontmatter, CRLF and body validation',()=>{
  assert.equal(parseSkill(markdown).name,'useful-skill');
  assert.equal(parseSkill(markdown.replaceAll('\n','\r\n')).description,'A useful task workflow.');
  assert.equal(parseSkill('# Plain Skill\n\nUseful instructions without frontmatter.').name,'Plain Skill');
  for(const text of ['', '---\nname: broken', '---\nname: [broken\n---\nbody'])assert.throws(()=>parseSkill(text),ApiError);
});
test('Publishing validates version, metadata and bounded SKILL.md',()=>{
  assert.equal(validatePublish(publish).version,'1.0.0');
  for(const change of [{version:'01.0.0'},{version:'latest'},{agents:[]},{agents:['unknown']},{license:''},{category:'unknown'},{id:'../../escape'},{markdown:'x'.repeat(200001)}])assert.throws(()=>validatePublish({...publish,...change}),ApiError);
});
test('Semantic versions sort numerically',()=>{
  assert.ok(compareVersion('1.10.0','1.9.0')>0);assert.ok(compareVersion('2.0.0','1.999.0')>0);assert.equal(compareVersion('1.0.0','1.0.0'),0);
});
test('Metadata updates accept optional display fields and reject invalid ones',()=>{
  const update=validateMetadataUpdate({name:'新名称',description:'  trimmed description ',category:'design',agents:['codex','cursor'],tags:['a','b'],license:'MIT'});
  assert.equal(update.name,'新名称');assert.equal(update.description,'trimmed description');assert.equal(update.category,'design');assert.deepEqual(update.agents,['codex','cursor']);assert.deepEqual(update.tags,['a','b']);assert.equal(update.license,'MIT');
  for(const change of [{},{name:'  '},{description:''},{category:'unknown'},{agents:[]},{agents:['nope']},{tags:['x'.repeat(31)]},{tags:[1]},{license:''},{name:'x'.repeat(121)}])assert.throws(()=>validateMetadataUpdate(change as Record<string,unknown>),ApiError);
});
test('Existing example snapshots retain exact content digests',async()=>{
  const seeds=JSON.parse(readFileSync(new URL('../lib/catalog.json',import.meta.url),'utf8'));
  for(const s of seeds){assert.equal(await digest(s.markdown),s.digest);parseSkill(s.markdown);}
});
test('Root, single-folder, Store and Deflate packages work',()=>{
  assert.equal(inspectPackage(zip()).markdown,markdown);
  assert.equal(inspectPackage(zip({'useful-skill/':new Uint8Array(),'useful-skill/SKILL.md':strToU8(markdown)})).root,'useful-skill/');
  assert.equal(inspectPackage(zipSync({'SKILL.md':strToU8(markdown)},{level:0})).markdown,markdown);
  assert.ok(inspectPackage(packageTemplate()).files.some(file=>file.path==='references/example.md'));
});
test('Scripts and binary resources remain part of the manifest',()=>{
  const result=inspectPackage(zip({'SKILL.md':strToU8(markdown),'scripts/task.py':strToU8('print("example")'),'assets/sample.bin':new Uint8Array([0,255,13,10])}));
  assert.deepEqual(result.files.map(f=>f.path),['SKILL.md','scripts/task.py','assets/sample.bin']);assert.equal(result.files[2].size,4);
});
test('Missing and multiple skill entries are rejected; nested entries and outside resources are retained',()=>{
  const invalid:Record<string,Uint8Array>[]=[{'README.md':strToU8(markdown)},{'a/SKILL.md':strToU8(markdown),'b/skill.md':strToU8(markdown)}];for(const files of invalid)reject(zip(files));
  const nested=inspectPackage(zip({'a/b/skill.md':strToU8(markdown),'outside.md':strToU8('outside')}));assert.equal(nested.entryPath,'a/b/skill.md');assert.ok(nested.files.some(f=>f.path==='outside.md'));
});
test('Traversal, absolute, Windows device and duplicate-case paths are rejected',()=>{
  for(const path of ['../evil','/evil','C:/evil','scripts\\..\\evil','scripts/../evil','CON.txt','scripts/name.'])reject(zip({'SKILL.md':strToU8(markdown),[path]:strToU8('x')}));
  reject(zip({'SKILL.md':strToU8(markdown),'assets/a.txt':strToU8('a'),'assets/A.txt':strToU8('b')}));
  reject(zip({'SKILL.md':strToU8(markdown),'assets':strToU8('a'),'assets/a.txt':strToU8('b')}));
});
test('Corruption, forged sizes and mismatched names fail validation',()=>{
  const corrupted=zip();corrupted[45]^=1;reject(corrupted);
  const forged=zip();const p=central(forged);new DataView(forged.buffer).setUint32(p+24,1,true);reject(forged);
  const names=zip();names[30]^=1;reject(names);
  reject(zip().subarray(0,40));reject(strToU8('not a zip'));
});
test('Symlinks and encrypted archives are rejected',()=>{
  const linked=zip();new DataView(linked.buffer).setUint32(central(linked)+38,0xa1ff0000,true);reject(linked);
  const encrypted=zip();new DataView(encrypted.buffer).setUint16(central(encrypted)+8,1,true);reject(encrypted);
});
test('Limits are checked before expanding untrusted contents',()=>{
  reject(new Uint8Array(MAX_ZIP_BYTES+1));
  const files:Record<string,Uint8Array>={'SKILL.md':strToU8(markdown)};for(let i=0;i<MAX_FILES;i++)files['references/'+i+'.md']=strToU8('x');reject(zip(files as Record<string,Uint8Array>));
  const bomb=zip();new DataView(bomb.buffer).setUint32(central(bomb)+24,MAX_EXPANDED_BYTES+1,true);reject(bomb);
});
