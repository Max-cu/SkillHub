import { openapi } from './openapi';

type Schema = { type?: string; format?: string; description?: string; default?: unknown; enum?: string[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; required?: string[]; properties?: Record<string, Schema> };
type Operation = { parameters?: {name:string;in:string;required?:boolean;schema:Schema}[]; requestBody?: {content:Record<string,{schema:Schema}>}; responses:Record<string,{description:string;content?:Record<string,unknown>}> };
const groups = ['技能', 'AgentHub', '社区审核', '留言', '密钥', '认证', '系统'] as const;
const titles: Record<string, string> = {
  'GET /skills':'搜索技能', 'POST /skills':'发布 ZIP / 新版本', 'GET /skills/{id}':'技能详情',
  'PATCH /skills/{id}':'编辑展示资料', 'DELETE /skills/{id}':'删除技能',
  'GET /skills/{id}/versions':'版本记录与下载量', 'DELETE /skills/{id}/versions/{version}':'删除单个私有版本', 'GET /skills/{id}/file':'读取 SKILL.md',
  'GET /skills/{id}/package':'包内容与摘要', 'GET /skills/{id}/download':'下载原始 ZIP',
  'PUT /skills/{id}/favorite':'加入收藏', 'DELETE /skills/{id}/favorite':'取消收藏',
  'GET /package-template':'下载示例包', 'GET /agents':'我的 Agent', 'POST /agents':'新建 Agent',
  'GET /agents/{id}':'Agent 详情', 'PATCH /agents/{id}':'更新 Agent', 'DELETE /agents/{id}':'删除 Agent',
  'POST /agents/{id}/invoke':'调用回执', 'GET /messages':'留言列表', 'POST /messages':'发布便利贴',
  'GET /messages/{id}':'留言全文', 'GET /keys':'密钥列表', 'POST /keys':'创建密钥',
  'DELETE /keys/{id}':'撤销密钥', 'GET /health':'健康检查', 'GET /meta':'工作区信息',
  'GET /openapi.json':'OpenAPI 规范',
  'POST /skills/{id}/ai':'重试 AI 整理','POST /skills/{id}/reviews/{reviewId}/ai-retry':'重试 AI 审核','DELETE /admin/skills/{id}/community':'管理员下架社区技能','POST /admin/skills/{id}/community/unblock':'解除下架限制','DELETE /messages/{id}':'管理员删除便签','POST /skills/{id}/community':'提交社区审核','DELETE /skills/{id}/community':'撤回社区','GET /skills/{id}/reviews':'我的审核记录','GET /admin/reviews':'社区审核列表','GET /admin/reviews/{id}':'审核记录','GET /admin/reviews/{id}/skill':'查看提交版本','GET /admin/reviews/{id}/file':'读取提交原文','GET /admin/reviews/{id}/package':'查看提交包内容','GET /admin/reviews/{id}/download':'下载提交版本','POST /admin/reviews/{id}/decision':'通过或驳回审核','GET /auth/login':'公司登录', 'POST /auth/cas/exchange':'交换登录票据', 'GET /auth/me':'当前登录身份', 'POST /auth/logout':'退出登录',
};
const descriptions: Record<string, string> = {
  q:'搜索名称、描述、标签或 SKILL.md 正文。', category:'技能分类。', favorites:'只查看工作区收藏，设为 true。',
  offset:'从第几条开始，配合 limit 分页。', limit:'每页条数。', agent:'按声明适用的 Agent 过滤。', sort:'结果排序。',
  id:'记录 ID。技能发布时可省略并取 frontmatter.name；留言、密钥和 Agent 使用对应记录的 ID。', version:'数字 x.y.z；上传可省略以自动递增，读取省略时为自己最新版或已通过的社区版本。',
  description:'说明。技能发布时可覆盖 SKILL.md 中的描述；Agent 为简介。',
  file:'ZIP 最大 50 MiB；包含一个 UTF-8 SKILL.md（不区分大小写），支持最多 12 层目录；缺失元数据自动推断，完整保留所有资源。',
  license:'许可证声明。', agents:'JSON 数组字符串，例如 ["codex","claude-code"]。',
  tags:'JSON 数组字符串，例如 ["example"]。', changelog:'本次版本说明。',
  content:'便签纯文本，不能为空。', author:'显示署名，省略时为匿名访客；不是登录身份。',
  color:'便签颜色。', position:'白板中的相对位置，省略时自动排布；填写时 x 和 y 均需提供。',
  'position.x':'横向位置，0 为左侧，1 为右侧。', 'position.y':'纵向位置，0 为上方，1 为下方。',
  name:'名称。',decision:'approve 通过；reject 驳回。只有管理员可处理待审核版本。',reason:'审核说明，最多 1000 字符。',status:'状态。审核列表为 pending / approved / rejected / withdrawn / all；Agent 为 draft / published。',scope:'read / write 为 Key 权限；mine / community / all 为技能库范围；Agent 列表目前仅为 mine。',
  slug:'所有者范围内唯一的小写标识。留空时按名称生成。',persona:'Agent 的系统提示，只保存，不在本接口执行。',tools:'工具范围标签，最多 20 项。',upstreamUrl:'可选的 http(s) 地址，只保存，本接口不会请求它。',input:'调用输入，原样写入回执。',context:'可选 JSON，原样写入回执。',config:'人设、工具范围和可选上游地址。',
  service:'精确登记的登录回调，协议、主机、端口及结尾 / 均须一致。',ticket:'CAS 一次性 ST 票据，不写入日志或浏览器存储。',
};
export const docOperations = Object.entries(openapi.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([verb, raw]) => {
    const method=verb.toUpperCase(), key=method+' '+path;
    return { key, anchor:verb+'-'+path.replace(/[{}]/g,'').replace(/\//g,'-').replace(/^-/,''), method, path,
      title:titles[key]??key, group:path.startsWith('/agents')?'AgentHub':path.startsWith('/admin')||path.endsWith('/community')||path.endsWith('/reviews')?'社区审核':path.startsWith('/skills')||path==='/package-template'?'技能':path.startsWith('/messages')?'留言':path.startsWith('/keys')?'密钥':path.startsWith('/auth')?'认证':'系统',
      operation:raw as Operation };
  })).sort((a,b)=>Object.keys(titles).indexOf(a.key)-Object.keys(titles).indexOf(b.key));
export { groups };
export type DocOperation = typeof docOperations[number];
export function docFields(doc:DocOperation) {
  const fields=(doc.operation.parameters??[]).map(p=>({name:p.name,location:p.in==='path'?'路径':'查询',required:!!p.required,schema:p.schema}));
  const body=Object.values(doc.operation.requestBody?.content??{})[0]?.schema;
  const add=(schema:Schema, prefix='', parentRequired=true)=>{
    for(const [name, value] of Object.entries(schema.properties??{})) {
      const full=prefix+name,required=parentRequired&&!!schema.required?.includes(name);
      fields.push({name:full,location:doc.operation.requestBody?.content['multipart/form-data']?'表单':'JSON',required,schema:value});
      if(value.properties)add(value,full+'.',required);
    }
  };
  if(body)add(body);
  return fields.map(f=>({...f,description:descriptions[f.name]??f.schema.description??'',rules:[
    f.schema.enum?.join(' / '),f.schema.default!==undefined?'默认 '+JSON.stringify(f.schema.default):'',
    f.schema.minimum!==undefined?'最小 '+f.schema.minimum:'',f.schema.maximum!==undefined?'最大 '+f.schema.maximum:'',
    f.schema.minLength!==undefined?'至少 '+f.schema.minLength+' 字符':'',f.schema.maxLength!==undefined?'最多 '+f.schema.maxLength+' 字符':'',
  ].filter(Boolean).join(' · ')}));
}
export function docExample(doc:DocOperation, origin:string, language:'curl'|'powershell') {
  const id=doc.group==='AgentHub'?'AGENT_ID':doc.path.startsWith('/admin/skills')?'SKILL_ID':doc.path.startsWith('/admin')?'REVIEW_ID':doc.group==='留言'?'MESSAGE_ID':doc.group==='密钥'?'KEY_ID':'my-skill';
  let url=origin+'/api/v1'+doc.path.replace('{id}',id).replace('{reviewId}','REVIEW_ID');
  if(doc.key==='GET /skills')url+='?scope=mine&q=react&limit=12';
  if(!doc.path.startsWith('/admin')&&['/file','/package','/download'].some(p=>doc.path.endsWith(p)))url+='?version=1.0.0';
  const body=doc.key==='POST /agents'?{name:'值班助手',slug:'duty-assistant',description:'回答值班问题',status:'draft',config:{persona:'你是值班助手。',tools:['search']}}:doc.key==='PATCH /agents/{id}'?{status:'published',config:{persona:'你是值班助手。'}}:doc.key==='POST /agents/{id}/invoke'?{input:'今天有哪些待办？',context:{locale:'zh-CN'}}:doc.path.startsWith('/admin/skills')?{reason:'管理员处理不合规社区内容'}:(doc.key==='POST /skills/{id}/community'||doc.key==='POST /skills/{id}/ai')?{version:'1.0.0'}:doc.key==='POST /admin/reviews/{id}/decision'?{decision:'approve',reason:'审核通过'}:doc.key==='POST /messages'?{content:'通过 API 留下一张便签',author:'Alex',color:'yellow',position:{x:0.35,y:0.6}}:doc.key==='POST /keys'?{name:'my-integration',scope:'read'}:doc.key==='POST /auth/cas/exchange'?{ticket:'ST-REPLACE-WITH-ONE-TIME-TICKET',service:origin+'/'}:null;
  const session=doc.group==='密钥'||doc.group==='认证',protectedCall=!['/health','/openapi.json'].includes(doc.path)&&doc.group!=='认证';
  if(doc.key==='GET /auth/login')return language==='powershell'?`Start-Process "${url}"`:`# 在浏览器打开\n# ${url}`;
  const cookieName=origin.startsWith('https:')?'__Host-skillhub_session':'skillhub_cas_session';
  const attemptName=origin.startsWith('https:')?'__Host-skillhub_login':'skillhub_cas_login';
  const header=session?`Cookie: ${doc.path.endsWith('/exchange')?attemptName:cookieName}=YOUR_SESSION_TOKEN`:'Authorization: Bearer sg_YOUR_API_KEY';
  const zip=doc.path.endsWith('/download')||doc.path==='/package-template';
  const output=zip?(doc.path==='/package-template'?'skill-template.zip':'my-skill-1.0.0.zip'):doc.path.endsWith('/file')?'SKILL.md':doc.path==='/openapi.json'?'openapi.json':null;
  if(language==='powershell'&&doc.key!=='POST /skills') {
    const lines=[];
    const headers=(protectedCall||session)?`$headers = @{\n  '${header.split(': ')[0]}' = '${header.split(': ').slice(1).join(': ')}'${doc.group==='认证'?`\n  'Origin' = '${origin}'`:''}\n}`:'';
    if(headers)lines.push(headers);
    if(body)lines.push('$body = @\'\n'+JSON.stringify(body,null,2)+'\n\'@');
    lines.push(`${output?'Invoke-WebRequest':'Invoke-RestMethod'} -Uri "${url}" -Method ${doc.method}`+(headers?' -Headers $headers':'')+(body?' -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))':'')+(output?` -OutFile "${output}"`:''));
    return lines.join('\n\n');
  }
  const command=language==='powershell'?'curl.exe':'curl';
  if(doc.key==='POST /skills')return `${command} -fS "${url}" -H "${header}" -F "file=@my-skill.zip" -F "version=1.0.0" -F "category=development"`;
  return `${command} -fS${doc.method==='GET'?'':' -X '+doc.method} "${url}"`+((protectedCall||session)?` -H "${header}"`:'')+(doc.group==='认证'?` -H "Origin: ${origin}"`:'')+(body?` -H "Content-Type: application/json" --data '${JSON.stringify(body)}'`:'')+(output?` -o "${output}"`:'');
}
