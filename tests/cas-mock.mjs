import http from 'node:http';
const expected=process.env.CAS_MOCK_SERVICE||'http://127.0.0.1:3356/';
const namespace='http://www.yale.edu/tp/cas';
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://cas-mock:8123');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/cas/login'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<p>Isolated CAS test double</p>');return;}
  if(url.pathname!=='/cas/serviceValidate'){res.writeHead(404);res.end();return;}
  const ticket=url.searchParams.get('ticket')||'';
  if(url.searchParams.get('service')!==expected){res.end(`<cas:serviceResponse xmlns:cas="${namespace}"><cas:authenticationFailure code="INVALID_SERVICE"/></cas:serviceResponse>`);return;}
  if(ticket.startsWith('ST-Redirect-')){res.writeHead(302,{Location:'http://cas-mock:8123/cas/login'});res.end();return;}
  res.setHeader('Content-Type','text/html;charset=UTF-8');
  if(ticket.startsWith('ST-HTML-')){res.end('<html><body>Gateway login</body></html>');return;}
  if(ticket.startsWith('ST-XML-')){res.end('<cas:serviceResponse>broken');return;}
  if(ticket.startsWith('ST-DTD-')){res.end('<!DOCTYPE x SYSTEM "file:///etc/passwd"><x/>');return;}
  if(ticket.startsWith('ST-Large-')){res.end('x'.repeat(66000));return;}
  const subject=ticket.startsWith('ST-Alice-')?'alice':ticket.startsWith('ST-Bob-')?'bob':ticket.startsWith('ST-Charlie-')?'charlie':null;
  if(!subject){res.end(`<cas:serviceResponse xmlns:cas="${namespace}"><cas:authenticationFailure code="INVALID_TICKET"/></cas:serviceResponse>`);return;}
  res.end(`<cas:serviceResponse xmlns:cas="${namespace}"><cas:authenticationSuccess><cas:user>${subject}</cas:user><cas:attributes><cas:displayName>${subject==='alice'?'用户甲':'用户乙'}</cas:displayName></cas:attributes></cas:authenticationSuccess></cas:serviceResponse>`);
});
server.listen(8123,'0.0.0.0',()=>console.log('Isolated CAS mock ready. No request logging.'));
