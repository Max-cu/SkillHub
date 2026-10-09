import http from 'node:http';
let recovered=false;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://ai-mock:8124');
 if(url.pathname==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'qwen3.5'}]}));return;}
 if(url.pathname==='/recover'){recovered=true;res.end('ok');return;}
 if(url.pathname!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw),summary=body.messages[0].content.includes('资料整理员'),input=body.messages[1].content;
 if(!summary&&input.includes('QA_AI_FAIL')&&!recovered){res.writeHead(503);res.end('unavailable');return;}
 let output=summary?{summary:'这项技能用于整理企业内部工作资料并生成清晰的操作说明，适合日常知识管理与效率提升。',category:'productivity',tags:['效率','知识整理']}:{decision:input.includes('QA_AI_REJECT')?'reject':input.includes('QA_AI_MANUAL')?'manual':'approve',reason:input.includes('QA_AI_REJECT')?'测试内容存在明确违规风险，不予发布。':input.includes('QA_AI_MANUAL')?'该测试内容需要人工核对，不自动通过。':'用途清楚，已检查提交的文本资源，未发现明显不合规行为。'};
 if(!summary&&input.includes('QA_AI_INVALID'))output={decision:'approve'};
 if(!summary&&input.includes('QA_AI_DELAY'))await new Promise(resolve=>setTimeout(resolve,3000));
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));
});
server.listen(8124,'0.0.0.0',()=>console.log('Isolated AI mock ready. No input logging.'));
