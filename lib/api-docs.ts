import { openapi } from './openapi';

type Schema = { type?: string; format?: string; description?: string; default?: unknown; enum?: string[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; required?: string[]; properties?: Record<string, Schema> };
type Operation = { parameters?: {name:string;in:string;required?:boolean;schema:Schema}[]; requestBody?: {content:Record<string,{schema:Schema}>}; responses:Record<string,{description:string;content?:Record<string,unknown>}> };
const groups = ['技能', '留言', '密钥', '系统'] as const;
const titles: Record<string, string> = {
  'GET /skills':'搜索技能', 'POST /skills':'发布 ZIP / 新版本', 'GET /skills/{id}':'技能详情',
  'GET /skills/{id}/versions':'版本记录', 'GET /skills/{id}/file':'读取 SKILL.md',
  'GET /skills/{id}/package':'包内容与摘要', 'GET /skills/{id}/download':'下载原始 ZIP',
  'PUT /skills/{id}/favorite':'加入收藏', 'DELETE /skills/{id}/favorite':'取消收藏',
  'GET /package-template':'下载示例包', 'GET /messages':'留言列表', 'POST /messages':'发布便利贴',
  'GET /messages/{id}':'留言全文', 'GET /keys':'密钥列表', 'POST /keys':'创建密钥',
  'DELETE /keys/{id}':'撤销密钥', 'GET /health':'健康检查', 'GET /meta':'工作区信息',
  'GET /openapi.json':'OpenAPI 规范',
};
const descriptions: Record<string, string> = {
  q:'搜索名称、描述或标签。', category:'技能分类。', favorites:'只查看工作区收藏，设为 true。',
  offset:'从第几条开始，配合 limit 分页。', limit:'每页条数。', agent:'按声明适用的 Agent 过滤。', sort:'结果排序。',
  id:'技能 ID；留言和密钥接口使用对应记录的 ID。发布时省略则取 frontmatter.name。', version:'数字 x.y.z；读取时省略即为最新版。',
  file:'标准 ZIP，最大 5 MiB。根目录或单一顶层文件夹包含一个 UTF-8 SKILL.md；完整保留脚本与资源。',
  license:'许可证声明。', agents:'JSON 数组字符串，例如 ["codex","claude-code"]。',
  tags:'JSON 数组字符串，例如 ["example"]。', description:'覆盖 SKILL.md 中的描述。', changelog:'本次版本说明。',
  content:'便签纯文本，不能为空。', author:'显示署名，省略时为匿名访客；不是登录身份。',
  color:'便签颜色。', position:'白板中的相对位置，省略时自动排布；填写时 x 和 y 均需提供。',
  'position.x':'横向位置，0 为左侧，1 为右侧。', 'position.y':'纵向位置，0 为上方，1 为下方。',
  name:'密钥名称。', scope:'read 只读；write 支持读取和写入。',
};
export const docOperations = Object.entries(openapi.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([verb, raw]) => {
    const method=verb.toUpperCase(), key=method+' '+path;
    return { key, anchor:verb+'-'+path.replace(/[{}]/g,'').replace(/\//g,'-').replace(/^-/,''), method, path,
      title:titles[key]??key, group:path.startsWith('/skills')||path==='/package-template'?'技能':path.startsWith('/messages')?'留言':path.startsWith('/keys')?'密钥':'系统',
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
  const id=doc.group==='留言'?'MESSAGE_ID':doc.group==='密钥'?'KEY_ID':'my-skill';
  let url=origin+'/api/v1'+doc.path.replace('{id}',id);
  if(doc.key==='GET /skills')url+='?q=react&limit=12';
  if(['/file','/package','/download'].some(p=>doc.path.endsWith(p)))url+='?version=1.0.0';
  const body=doc.key==='POST /messages'?{content:'通过 API 留下一张便签',author:'Alex',color:'yellow',position:{x:0.35,y:0.6}}:doc.key==='POST /keys'?{name:'my-integration',scope:'read'}:null;
  const zip=doc.path.endsWith('/download')||doc.path==='/package-template';
  const output=zip?(doc.path==='/package-template'?'skill-template.zip':'my-skill-1.0.0.zip'):doc.path.endsWith('/file')?'SKILL.md':doc.path==='/openapi.json'?'openapi.json':null;
  if(language==='powershell'&&doc.key!=='POST /skills') {
    const lines=[];
    if(body)lines.push('$body = @\'\n'+JSON.stringify(body,null,2)+'\n\'@');
    lines.push(`${output?'Invoke-WebRequest':'Invoke-RestMethod'} -Uri "${url}" -Method ${doc.method}`+(body?' -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))':'')+(output?` -OutFile "${output}"`:''));
    return lines.join('\n\n');
  }
  const command=language==='powershell'?'curl.exe':'curl';
  if(doc.key==='POST /skills')return `${command} -fS "${url}" -F "file=@my-skill.zip" -F "version=1.0.0" -F "category=development"`;
  return `${command} -fS${doc.method==='GET'?'':' -X '+doc.method} "${url}"`+(body?` -H "Content-Type: application/json" --data '${JSON.stringify(body)}'`:'')+(output?` -o "${output}"`:'');
}
