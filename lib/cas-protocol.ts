import { SaxesParser, type SaxesTagNS } from 'saxes';
import { ApiError } from './domain.ts';

const namespace = 'http://www.yale.edu/tp/cas';
export function parseCasResponse(xml:string) {
  if (Buffer.byteLength(xml,'utf8') > 65536 || /<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new ApiError(401,'invalid_ticket','CAS 响应无效');
  const stack:SaxesTagNS[]=[],parser=new SaxesParser({xmlns:true});
  let root=false,success=0,failure=false,userCount=0,subject='',displayName='';
  parser.on('opentag',tag=>{
    stack.push(tag);
    if(stack.length>16)throw new Error('XML depth exceeded');
    if(stack.length===1) { if(tag.uri!==namespace||tag.local!=='serviceResponse')throw new Error('Invalid CAS root');root=true; }
    if(stack.length===2&&tag.uri===namespace&&tag.local==='authenticationSuccess')success++;
    if(tag.uri===namespace&&tag.local==='authenticationFailure')failure=true;
    if(stack.length===3&&stack[1].local==='authenticationSuccess'&&stack[1].uri===namespace&&tag.uri===namespace&&tag.local==='user')userCount++;
    if(stack.length===4&&stack[2].local==='user')throw new Error('Nested user element');
  });
  const text=(value:string)=>{
    if(stack.length===3&&stack[1].uri===namespace&&stack[1].local==='authenticationSuccess'&&stack[2].uri===namespace&&stack[2].local==='user')subject+=value;
    if(stack.length===4&&stack[1].uri===namespace&&stack[1].local==='authenticationSuccess'&&stack[2].uri===namespace&&stack[2].local==='attributes'&&stack[3].uri===namespace&&stack[3].local==='displayName')displayName+=value;
  };
  parser.on('text',text);parser.on('cdata',text);parser.on('closetag',()=>{stack.pop();});
  try {parser.write(xml).close();}catch{throw new ApiError(401,'invalid_ticket','CAS 票据校验失败');}
  subject=subject.trim();displayName=displayName.trim();
  if(!root||success!==1||failure||userCount!==1||!subject||subject.length>256||/[\x00-\x1f\x7f]/.test(subject))throw new ApiError(401,'invalid_ticket','CAS 票据无效或已使用，请重新登录');
  return {subject,displayName:(displayName||subject).slice(0,80)};
}
export function validateTicketInput(value:unknown) {
  if(typeof value!=='string'||!/^ST-[A-Za-z0-9._~:-]{1,4090}$/.test(value))throw new ApiError(400,'invalid_ticket','CAS 票据格式无效');
  return value;
}
export async function validateCasTicket(ticket:string,service:string,base:string,fetcher:typeof fetch=fetch) {
  const url=new URL(base+'/serviceValidate');url.searchParams.set('ticket',ticket);url.searchParams.set('service',service);
  let response:Response;
  try {response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/xml, text/xml'},cache:'no-store'});}
  catch{throw new ApiError(502,'cas_unavailable','公司登录服务暂时不可用，请稍后重新登录');}
  if(!response.ok||response.status>=300)throw new ApiError(502,'cas_unavailable','公司登录服务响应异常');
  const reader=response.body?.getReader();if(!reader)throw new ApiError(401,'invalid_ticket','CAS 响应为空');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new ApiError(401,'invalid_ticket','CAS 响应过大');}chunks.push(value);}
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(502,'cas_unavailable','公司登录服务响应中断');}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  let xml:string;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ApiError(401,'invalid_ticket','CAS 响应编码无效');}
  // Some CAS servlets label XML as text/html; trust only the verified XML tree.
  return parseCasResponse(xml);
}
