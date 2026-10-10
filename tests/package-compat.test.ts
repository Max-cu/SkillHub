import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {parseSkill,metadataSlug,ApiError} from '../lib/domain.ts';
import {inspectPackage} from '../lib/package.ts';
const zip=(files:Record<string,Uint8Array>)=>zipSync(files,{level:0});
test('Display names are distinct from stable owner-scoped slugs',()=>{
 const a=parseSkill('---\nname: 天辰_报表 Skill\ndescription: 报表\n---\n# Report\nPrepare the report.');
 assert.equal(a.name,'天辰_报表 Skill');assert.equal(a.description,'报表');assert.match(a.slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
 assert.equal(a.slug,metadataSlug(a.name));assert.notEqual(a.slug,metadataSlug('另一份_报表 Skill'));
 assert.equal(parseSkill('---\nname: My_Skill\ndescription: Useful\n---\nbody').slug,'my-skill');
});
test('Plain Markdown and partial Frontmatter infer usable metadata without rewriting text',()=>{
 const body='# 文档整理\n\n将公开资料整理成文档。';
 const result=inspectPackage(zip({'tool/skill.md':strToU8(body)}));
 assert.equal(result.markdown,body);assert.equal(result.entryPath,'tool/skill.md');assert.equal(result.metadata.name,'tool');assert.ok(result.warnings.length);
 const partial=inspectPackage(zip({'SKILL.md':strToU8('---\nname: partial_skill\n---\n# Task\nUseful task instructions.')}));
 assert.equal(partial.metadata.name,'partial_skill');assert.equal(partial.metadata.description,'Useful task instructions.');
});
test('Nested entry, outside resources, BOM and Windows separators are accepted safely',()=>{
 const body='\ufeff# Wrapped Skill\n\nPublic documentation helper.';
 const result=inspectPackage(zip({'repo\\skills\\wrapped\\sKiLl.Md':strToU8(body),'repo/LICENSE':strToU8('MIT'),'README.md':strToU8('Instructions')}));
 assert.equal(result.markdown,body);assert.equal(result.entryPath,'repo/skills/wrapped/sKiLl.Md');assert.equal(result.files.length,3);assert.ok(result.files.some(f=>f.path==='README.md'));
 assert.throws(()=>inspectPackage(zip({'SKILL.md':strToU8(body),'..\\outside':strToU8('bad')})),ApiError);
});
test('More than the old 200 files and 5 MiB are retained, with complete resource CRC validation',()=>{
 const files:Record<string,Uint8Array>={'SKILL.md':strToU8('# Large Skill\n\nRead public assets.')};
 for(let i=0;i<240;i++)files['references/'+i+'.txt']=strToU8('Public reference.');
 files['assets/large.bin']=new Uint8Array(6*1024*1024);const bytes=zip(files),result=inspectPackage(bytes);
 assert.ok(bytes.length>5*1024*1024);assert.equal(result.files.length,242);assert.equal(result.files.find(f=>f.path==='assets/large.bin')?.size,6*1024*1024);
 const bad=bytes.slice();const needle=strToU8('Public reference.');let at=-1;outer:for(let i=0;i<bad.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(bad[i+j]!==needle[j])continue outer;at=i;break;}assert.ok(at>=0);bad[at]^=1;assert.throws(()=>inspectPackage(bad),ApiError);
});
test('SkillGo manifest supplies display name, slug and version; ordinary manifest stays an asset',()=>{
 const raw='# Work helper\n\nUse public notes to prepare a document.';
 const result=inspectPackage(zip({'bundle/skills/doc/SKILL.md':strToU8(raw),'skillgo.yaml':strToU8('apiVersion: skillgo.io/v1alpha1\nmetadata:\n  name: doc-helper\n  displayName: 文档助手\n  version: 1.2.3\nspec:\n  type: instruction\n'),'bundle/README.md':strToU8('Public docs')}));
 assert.equal(result.metadata.name,'文档助手');assert.equal(result.metadata.slug,'doc-helper');assert.equal(result.declaredVersion,'1.2.3');assert.equal(result.markdown,raw);
 const generic=inspectPackage(zip({'SKILL.md':strToU8(raw),'manifest.yaml':strToU8('name: asset-manifest\nversion: internal-v1')}));assert.equal(generic.declaredVersion,undefined);
});
test('Large UTF-8 text is accepted by character budget while malformed YAML remains rejected',()=>{
 const body='# 中文资料\n\n'+'文'.repeat(60000);assert.ok(strToU8(body).length>150000);assert.equal(inspectPackage(zip({'SKILL.md':strToU8(body)})).markdown,body);
 for(const body of ['---\nname: [broken\n---\nbody','---\nname: missing-close','---\n- item\n---\nbody'])assert.throws(()=>inspectPackage(zip({'SKILL.md':strToU8(body)})),ApiError);
});
