import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthConfig } from '../lib/cas-config.mjs';
import { parseCasResponse, validateTicketInput, validateCasTicket } from '../lib/cas-protocol.ts';

const config={SKILLHUB_CAS_SERVICE:'http://10.2.14.138:3356/'};
const valid=(subject='alice')=>`<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas"><cas:authenticationSuccess><cas:user>${subject}</cas:user><cas:attributes><cas:displayName>张三</cas:displayName></cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`;
test('CAS canonical service rejects userinfo, queries, fragments, missing slash and alternate paths',()=>{
  assert.equal(readAuthConfig(config).service,config.SKILLHUB_CAS_SERVICE);
  for(const service of ['http://10.2.14.138:3356','http://evil@10.2.14.138:3356/','http://10.2.14.138:3356/?next=evil','http://10.2.14.138:3356/#x','http://10.2.14.138:3356/callback'])assert.throws(()=>readAuthConfig({...config,SKILLHUB_CAS_SERVICE:service}));
  assert.throws(()=>readAuthConfig({}));
});
test('CAS rejects non-TLS endpoints and anonymous production mode; mock is isolated-test only',()=>{
  assert.throws(()=>readAuthConfig({...config,SKILLHUB_CAS_BASE_URL:'http://cas.china-tcc.com/cas'}));
  assert.throws(()=>readAuthConfig({SKILLHUB_AUTH_MODE:'local',NODE_ENV:'production'}));
  assert.throws(()=>readAuthConfig({...config,SKILLHUB_CAS_BASE_URL:'http://cas-mock:8123/cas',NODE_ENV:'production',SKILLHUB_AUTH_TEST_MODE:'isolated'}));
  assert.equal(readAuthConfig({...config,SKILLHUB_CAS_BASE_URL:'http://cas-mock:8123/cas',NODE_ENV:'test',SKILLHUB_AUTH_TEST_MODE:'isolated'}).mode,'cas');
});
test('CAS parser accepts only the exact success/user namespace tree',()=>{
  assert.deepEqual(parseCasResponse(valid()),{subject:'alice',displayName:'张三'});
  assert.equal(parseCasResponse(valid('a&amp;b')).subject,'a&b');
  const goodDefault='<serviceResponse xmlns="http://www.yale.edu/tp/cas"><authenticationSuccess><user>ALICE</user></authenticationSuccess></serviceResponse>';
  assert.equal(parseCasResponse(goodDefault).subject,'ALICE');
  for(const xml of [valid().replace('http://www.yale.edu/tp/cas','http://evil.invalid'),'<html><body>Access gateway</body></html>',valid().replace('<cas:user>alice</cas:user>','<cas:user/>'),valid().replace('</cas:authenticationSuccess>','<cas:user>bob</cas:user></cas:authenticationSuccess>'),valid().replace('</cas:authenticationSuccess>','<cas:authenticationFailure/></cas:authenticationSuccess>'),valid().replace('alice','<cas:user>alice</cas:user>'),valid().replace('</cas:authenticationSuccess>',''),'<wrap>'+valid()+'</wrap>',valid()+valid(),valid().replace('<cas:authenticationSuccess>','<cas:other><cas:authenticationSuccess>')])assert.throws(()=>parseCasResponse(xml));
});
test('CAS rejects DTD, entities and oversized XML or invalid tickets',()=>{
  for(const xml of ['<!DOCTYPE x SYSTEM "file:///etc/passwd">'+valid(),'<!DOCTYPE x [<!ENTITY a "x">]>'+valid(),valid('x'.repeat(66000)),valid('x'.repeat(257))])assert.throws(()=>parseCasResponse(xml));
  assert.equal(validateTicketInput('ST-abc-123'), 'ST-abc-123');
  for(const value of ['',null,'PT-123','ST-a\nheader','ST-'+ 'x'.repeat(4096)])assert.throws(()=>validateTicketInput(value));
});
test('CAS validation binds canonical service, refuses redirects and limits response bodies',async()=>{
  let captured:URL|undefined,options:RequestInit|undefined;
  const fetcher:typeof fetch=async(input,init)=>{captured=new URL(String(input));options=init;return new Response(valid(),{headers:{'Content-Type':'text/html'}});};
  const result=await validateCasTicket('ST-abc',config.SKILLHUB_CAS_SERVICE,'https://cas.china-tcc.com/cas',fetcher);
  assert.equal(result.subject,'alice');assert.equal(captured!.searchParams.get('service'),config.SKILLHUB_CAS_SERVICE);assert.equal(options!.redirect,'error');assert.ok(options!.signal);
  for(const response of [new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}),new Response('<html/>'),new Response('x'.repeat(65537))])await assert.rejects(()=>validateCasTicket('ST-abc',config.SKILLHUB_CAS_SERVICE,'https://cas.china-tcc.com/cas',async()=>response));
  await assert.rejects(()=>validateCasTicket('ST-abc',config.SKILLHUB_CAS_SERVICE,'https://cas.china-tcc.com/cas',async()=>{throw new Error('network failure');}));
});
