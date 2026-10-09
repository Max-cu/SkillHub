const string={type:'string'};
const error={description:'Request failed',content:{'application/json':{schema:{type:'object',properties:{error:{type:'object',properties:{code:string,message:string}}}}}}};
const ok={description:'Success. JSON returns { data: ... }',content:{'application/json':{schema:{type:'object',properties:{data:{}}}}}};
const response={200:ok,400:error,401:error,403:error,404:error,409:error,413:error,415:error,500:error};
const query=(name:string,schema:object={type:'string'})=>({name,in:'query',schema});
const id=(name:string)=>({name,in:'path',required:true,schema:string});
const requestBody=(properties:Record<string,unknown>,required:string[])=>({required:true,content:{'application/json':{schema:{type:'object',properties,required}}}});
const security=[{bearerAuth:[]},{}];
export const openapi={
  openapi:'3.1.0',info:{title:'SkillHub API',version:'0.3.0',description:'All active product operations use this API. Data is stored in dedicated PostgreSQL, isolated from SkillGo. Loopback and explicitly configured shared origins use the fixed local-workspace identity; no login integration is configured. Shared deployments have no user isolation and require a trusted network. Bearer keys retain read/write scopes. Browser mutations require a same-origin Origin when present and reject cross-site requests. Login is a UI placeholder. ZIP publication only; no GitHub imports or recipes.'},
  servers:[{url:'/api/v1'}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Optional for the local workspace; sg_… read/write API keys. Key administration uses the local workspace, not another key.'}}},
  paths:{
    '/health':{get:{summary:'Check database availability',responses:{200:ok,503:error}}},
    '/meta':{get:{summary:'Categories, counts and workspace mode; loginConfigured=false',responses:response}},
    '/openapi.json':{get:{summary:'Machine-readable API contract',responses:{200:{description:'This OpenAPI document'}}}},
    '/package-template':{get:{summary:'Download a valid example ZIP package',responses:{200:{description:'Example ZIP with SKILL.md and a reference',content:{'application/zip':{schema:{type:'string',format:'binary'}}}}}}},
    '/messages':{
      get:{summary:'List board notes, newest first; returns items,total,offset,limit,nextOffset',security,parameters:[query('offset',{type:'integer',minimum:0,default:0}),query('limit',{type:'integer',minimum:1,maximum:100,default:12})],responses:response},
      post:{summary:'Post a persistent sticky note to the shared board',security,requestBody:requestBody({content:{type:'string',minLength:1,maxLength:2000,description:'Plain text; blank notes are rejected'},author:{type:'string',maxLength:24,description:'Optional display name, not authenticated identity; defaults to 匿名访客'},color:{type:'string',enum:['yellow','blue','pink','green'],default:'yellow'},position:{type:'object',required:['x','y'],properties:{x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1}},description:'Optional normalized whiteboard position; preserved on reads. Omitted coordinates yield position=null and automatic placement.'}},['content']),responses:{...response,201:ok}},
    },
    '/messages/{id}':{get:{summary:'Read the full content of a posted note',security,parameters:[id('id')],responses:response}},
    '/skills':{
      get:{summary:'Search, category filter, favorites and pagination',parameters:[query('q'),query('category'),query('favorites',{type:'boolean'}),query('offset',{type:'integer',minimum:0,default:0}),query('limit',{type:'integer',minimum:1,maximum:100,default:24}),query('agent',{type:'string',description:'Optional API filter; no UI control'}),query('sort',{type:'string',enum:['featured','newest','name','compact'],description:'Optional API sort; no UI control'})],responses:response},
      post:{summary:'Upload a complete immutable standard ZIP package',security,requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:['file'],properties:{file:{type:'string',format:'binary',description:'One .zip, max 5 MiB; max 200 entries, 20 MiB expanded. Exactly one UTF-8 SKILL.md at root or a single top-level folder. Name and description in YAML frontmatter. Resources preserved. No symlinks, traversal, encryption or ZIP64.'},id:{type:'string',description:'Defaults to frontmatter name'},version:{type:'string',default:'0.1.0'},category:{type:'string',enum:['development','design','productivity','testing','documentation'],default:'development'},license:{type:'string',default:'Unspecified'},agents:{type:'string',description:'JSON array of declared agents; defaults to all four supported agent labels'},tags:{type:'string',description:'JSON string array',default:'[]'},description:string,changelog:string}}}}},responses:{...response,201:ok}},
    },
    '/skills/{id}':{get:{summary:'Skill details and latest SKILL.md',parameters:[id('id')],responses:response}},
    '/skills/{id}/versions':{get:{summary:'List immutable versions',parameters:[id('id')],responses:response}},
    '/skills/{id}/file':{get:{summary:'Read exact SKILL.md',parameters:[id('id'),query('version')],responses:{200:{description:'Raw UTF-8 Markdown with X-Skill-Digest and ETag',content:{'text/markdown':{schema:string}}},404:error}}},
    '/skills/{id}/package':{get:{summary:'Read version-specific ZIP digest, file list, size, root and provenance kind',parameters:[id('id'),query('version')],responses:response}},
    '/skills/{id}/download':{get:{summary:'Download exact original uploaded ZIP, preserving resources',parameters:[id('id'),query('version')],responses:{200:{description:'ZIP attachment with X-Package-Digest and ETag. Existing catalog-markdown examples are synthetic ZIPs containing only SKILL.md; package.kind distinguishes them.',content:{'application/zip':{schema:{type:'string',format:'binary'}}}},404:error}}},
    '/skills/{id}/favorite':{put:{summary:'Add favorite (idempotent)',parameters:[id('id')],security,responses:response},delete:{summary:'Remove favorite (idempotent)',parameters:[id('id')],security,responses:response}},
    '/keys':{get:{summary:'List workspace key metadata; secrets never returned',responses:response},post:{summary:'Create read/write key; token returned only once',requestBody:requestBody({name:{type:'string',maxLength:60},scope:{type:'string',enum:['read','write'],default:'read'}},['name']),responses:{...response,201:ok}}},
    '/keys/{id}':{delete:{summary:'Revoke local workspace key',parameters:[id('id')],responses:response}},
  },
};
