import { writeFile, mkdir } from 'node:fs/promises';
const origin='http://127.0.0.1:5173';
const response=await fetch(origin+'/api/v1/skills?q=qa-&limit=100');
const payload=await response.json();
const ids=[];
for(const entry of payload.data.items){
  if(!/^qa-(?:skill|import)-\d{13}$/.test(entry.id))continue;
  const skill=await (await fetch(origin+'/api/v1/skills/'+entry.id)).json();
  if(['local_seedy','local-workspace'].includes(skill.data.owner))ids.push(entry.id);
}
if(!ids.length){console.log('No temporary QA fixtures.');process.exit(0);}
const values=ids.map(id=>`'${id}'`).join(',');
await mkdir('outputs',{recursive:true});
await writeFile('outputs/qa-cleanup.sql',`DELETE FROM favorites WHERE skill_id IN (${values});\nDELETE FROM package_chunks WHERE skill_id IN (${values});\nDELETE FROM packages WHERE skill_id IN (${values});\nDELETE FROM versions WHERE skill_id IN (${values});\nDELETE FROM skills WHERE id IN (${values});`);
console.log(`Prepared cleanup for ${ids.length} locally created QA skills: ${ids.join(', ')}`);
