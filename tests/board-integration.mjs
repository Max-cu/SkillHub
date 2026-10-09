import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const origin=process.env.SKILLHUB_TEST_ORIGIN??'http://127.0.0.1:5173';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))throw new Error('Board tests are local only.');
const base=origin+'/api/v1', ids=[];let keyId;let assertions=0;
const check=(condition,label)=>{assert.ok(condition,label);assertions++;};
const request=async(path,options={})=>{const response=await fetch(base+'/'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const text=await response.text();let payload;try{payload=JSON.parse(text);}catch{payload={error:{message:text}};}return {status:response.status,payload};};
try{
  const contract=await (await fetch(base+'/openapi.json')).json();check(contract.paths['/messages'].post&&contract.paths['/messages/{id}'].get,'board operations documented');
  const first=await request('messages');check(first.status===200&&Array.isArray(first.payload.data.items),'board reads without cookie');const originalTotal=first.payload.data.total;
  const content='QA board fixture\n<script>not executable</script>\n'+'完整留言。'.repeat(60);
  const created=await request('messages',{method:'POST',body:JSON.stringify({content,author:'QA-board',color:'blue',position:{x:.35,y:.6}})});check(created.status===201,'publish note via API');ids.push(created.payload.data.id);const id=ids[0];
  check(created.payload.data.content===content&&created.payload.data.color==='blue','plain text and color preserved');check(!('owner' in created.payload.data),'internal identity not exposed');
  const read=await request('messages/'+id);check(read.status===200&&read.payload.data.content===content,'full message persisted');check(read.payload.data.id===id&&!!read.payload.data.createdAt,'stable id and timestamp');
  check(read.payload.data.position.x===.35&&read.payload.data.position.y===.6,'whiteboard position persisted');
  const anon=await request('messages',{method:'POST',body:JSON.stringify({content:'QA anonymous fixture'})});check(anon.status===201&&anon.payload.data.author==='匿名访客'&&anon.payload.data.color==='yellow','anonymous defaults');ids.push(anon.payload.data.id);
  const list=await request('messages?limit=1');check(list.payload.data.total===originalTotal+2&&list.payload.data.items.length===1,'count and page limit');check(list.payload.data.items[0].id===ids[1]&&list.payload.data.nextOffset===1,'newest-first pagination');
  check(list.payload.data.items[0].position===null,'API callers can omit coordinates');
  const second=await request('messages?limit=1&offset=1');check(second.payload.data.items[0].id===id,'next page retrieves older note');
  check((await request('messages/'+crypto.randomUUID())).status===404,'unknown note returns 404');
  check((await request('messages?limit=101')).status===400,'pagination bounds');
  for(const value of [{content:'   '},{content:'a'.repeat(2001)},{content:'hi',author:'a'.repeat(25)},{content:'hi',color:'red'},{content:'hi',position:{x:2,y:.5}},{content:'hi',position:{x:.5}}])check((await request('messages',{method:'POST',body:JSON.stringify(value)})).status===400,'reject invalid note');
  check((await request('messages',{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify({content:'cross site'})})).status===403,'cross-site mutation denied');
  const key=await request('keys',{method:'POST',body:JSON.stringify({name:'QA board read',scope:'read'})});check(key.status===201,'prepare scoped test key');keyId=key.payload.data.id;const auth={Authorization:'Bearer '+key.payload.data.token};
  check((await request('messages/'+id,{headers:auth})).status===200,'read key reads note');check((await request('messages',{method:'POST',headers:auth,body:JSON.stringify({content:'denied'})})).status===403,'read key cannot post');
  const after=await request('messages');check(after.payload.data.total===originalTotal+2,'failed requests created no notes');
  console.log(`${assertions} board API checks passed.`);
}finally{
  if(keyId)await request('keys/'+keyId,{method:'DELETE'});
  await mkdir('outputs',{recursive:true});
  await writeFile('outputs/qa-board-ids.json',JSON.stringify(ids));
  if(ids.length)await writeFile('outputs/qa-board-cleanup.sql',`DELETE FROM messages WHERE id IN (${ids.map(id=>"'"+id+"'").join(',')}) AND author IN ('QA-board','匿名访客');`);
}
