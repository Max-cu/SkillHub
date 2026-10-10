import { Inflate, strToU8, zipSync } from 'fflate';
import { ApiError, parseSkill } from './domain.ts';
import { parse } from 'yaml';
import {MAX_ZIP_BYTES,MAX_EXPANDED_BYTES,MAX_FILES,MAX_ENTRIES,MAX_MARKDOWN_BYTES} from './package-limits.mjs';
export {MAX_ZIP_BYTES} from './package-limits.mjs';

export type PackageInfo = {root:string;entryPath:string;markdown:string;metadata:ReturnType<typeof parseSkill>;declaredVersion?:string;warnings:string[];files:{path:string;size:number}[]};
const invalid = (message: string): never => { throw new ApiError(400, 'invalid_package', message); };
const utf8 = new TextDecoder('utf-8', { fatal: true,ignoreBOM:true });

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function safePath(name:string) {
  const normalized=name.replaceAll('\\','/');
  if(!normalized||normalized.length>1024||/[\x00-\x1f\x7f:]/.test(normalized)||normalized.startsWith('/'))invalid('ZIP 包含不安全的文件路径');
  const parts=normalized.split('/').filter(part=>part&&part!=='.');
  if(!parts.length||parts.length>12)invalid('ZIP 路径层级过深');
  for(const part of parts)if(part==='..'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))invalid('ZIP 包含不安全的文件路径');
  return parts.join('/');
}
const cp437='ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0';
function filename(bytes:Uint8Array,flags:number) {
  try{return utf8.decode(bytes);}catch{if(flags&0x800)invalid('UTF-8 ZIP 文件名损坏');return Array.from(bytes,b=>b<128?String.fromCharCode(b):cp437[b-128]).join('');}
}
// Read central and local headers before inflating. No archive contents are executed or extracted to disk.
export function inspectPackage(bytes: Uint8Array,options:{filename?:string}={}): PackageInfo {
  if (bytes.length > MAX_ZIP_BYTES) throw new ApiError(413, 'package_too_large', 'ZIP 最大为 50 MB');
  if (bytes.length < 22) invalid('文件不是有效 ZIP 包');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => data.getUint16(p, true), u32 = (p: number) => data.getUint32(p, true);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) invalid('ZIP 目录损坏');
  const count = u16(end + 10), directorySize = u32(end + 12), directoryOffset = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 65535 || directoryOffset === 0xffffffff) invalid('不支持分卷或 ZIP64');
  if (!count || count > MAX_ENTRIES || directoryOffset + directorySize !== end) invalid('ZIP 目录必须完整，最多包含 20000 个文件');
  const entries: { name: string; offset: number; compressed: number; size: number; crc: number; method: number; directory: boolean }[] = [];
  const names = new Set<string>();
  let p = directoryOffset, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) invalid('ZIP 目录损坏');
    const flags = u16(p + 8), method = u16(p + 10), compressed = u32(p + 20), size = u32(p + 24);
    const nameLength = u16(p + 28), extraLength = u16(p + 30), commentLength = u16(p + 32), offset = u32(p + 42);
    if ((flags & 1) || (flags & 0x40) || ![0, 8].includes(method)) invalid('仅支持未加密的标准 ZIP（Store / Deflate）');
    if (u16(p + 34) || [compressed, size, offset].includes(0xffffffff)) invalid('不支持分卷或 ZIP64');
    if (p + 46 + nameLength + extraLength + commentLength > end) invalid('ZIP 文件名损坏');
    const rawName=filename(bytes.subarray(p+46,p+46+nameLength),flags);
    const normalized=safePath(rawName),folded=normalized.normalize('NFC').toLowerCase();
    const mode=(u32(p+38)>>>16)&0xf000,attributes=u32(p+38);
    const directory=rawName.replaceAll('\\','/').endsWith('/')||mode===0x4000||(!!(attributes&0x10)&&size===0);
    const name=normalized+(directory?'/':'');
    if (names.has(folded)) invalid('ZIP 包含重复或大小写冲突的路径');
    names.add(folded);
    if (mode && mode !== 0x8000 && mode !== 0x4000) invalid('ZIP 不允许符号链接或特殊文件');
    if (directory && size !== 0) invalid('ZIP 目录条目无效');
    expanded += size;
    if (size > MAX_EXPANDED_BYTES || expanded > MAX_EXPANDED_BYTES) throw new ApiError(413, 'expanded_package_too_large', '解压总量及单文件最大 250 MB');
    if (offset + 30 > directoryOffset || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) invalid('ZIP 本地文件头不匹配');
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    if (start + compressed > directoryOffset || localNameLength !== nameLength) invalid('ZIP 文件范围无效');
    for (let n = 0; n < nameLength; n++) if (bytes[offset + 30 + n] !== bytes[p + 46 + n]) invalid('ZIP 本地文件名不匹配');
    if(!(flags&8)) {
      let localCompressed=u32(offset+18),localSize=u32(offset+22);
      if(localCompressed===0xffffffff||localSize===0xffffffff) {
        let extra=offset+30+localNameLength,found=false;
        const extraEnd=extra+localExtraLength;
        while(extra+4<=extraEnd){const kind=u16(extra),length=u16(extra+2);extra+=4;if(extra+length>extraEnd)invalid('ZIP 扩展字段损坏');if(kind===1){if(length<16)invalid('ZIP64 文件大小缺失');const n=(at:number)=>u32(at)+u32(at+4)*4294967296;localSize=n(extra);localCompressed=n(extra+8);found=true;break;}extra+=length;}
        if(!found)invalid('ZIP64 文件大小缺失');
      }
      if(u32(offset+14)!==u32(p+16)||localCompressed!==compressed||localSize!==size)invalid('ZIP 文件大小或校验和不匹配');
    }
    entries.push({ name: name!, offset: start, compressed, size, crc: u32(p + 16), method, directory });
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (p !== end) invalid('ZIP 目录长度无效');
  const ordered = [...entries].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < ordered.length; i++) if (ordered[i].offset < ordered[i - 1].offset + ordered[i - 1].compressed) invalid('ZIP 文件范围重叠');
  const actualFiles=entries.filter(e=>!e.directory);if(actualFiles.length>MAX_FILES)invalid('ZIP 最多包含 20000 个文件');
  const meaningful=entries.filter(e=>!e.name.split('/').some(part=>part.toLowerCase()==='__macosx'||part.startsWith('._'))&&e.name.split('/').at(-1)!=='.DS_Store');
  const skillFiles=meaningful.filter(e=>!e.directory&&e.name.split('/').at(-1)?.toLowerCase()==='skill.md');
  if(skillFiles.length!==1)invalid('ZIP 必须且只能包含一个 SKILL.md（文件名不区分大小写）');
  const skill=skillFiles[0],root=skill.name.slice(0,skill.name.lastIndexOf('/')+1),warnings:string[]=[];
  if(skill.name.split('/').at(-1)!=='SKILL.md')warnings.push('已兼容识别非标准大小写的 Skill 入口文件。');
  const relative=root&&meaningful.every(e=>e.name===root||e.name.startsWith(root));
  const files=meaningful.filter(e=>!e.directory).map(e=>({path:relative?e.name.slice(root.length):e.name,size:e.size}));
  const filePaths=new Set(actualFiles.map(e=>e.name.slice(0,e.name.endsWith('/')?-1:undefined)));
  for(const entry of actualFiles){const parts=entry.name.split('/');for(let i=1;i<parts.length;i++)if(filePaths.has(parts.slice(0,i).join('/')))invalid('ZIP 中的文件与文件夹路径冲突');}
  const manifestNames=['skillgo.yaml','manifest.skillgo.yaml','manifest.yaml'];
  const candidates=manifestNames.flatMap(name=>[root+name,...(root&&name!=='manifest.yaml'?[name]:[])]);
  const captured=new Map<string,string>();
  let markdown = '';
  // Validate every resource, including actual expanded byte counts and CRC, so downloads preserve a valid complete package.
  for (const entry of entries) {
    const chunks: Uint8Array[] = [];
    let size = 0,crc=0xffffffff;const capture=entry===skill||candidates.includes(entry.name);
    if(capture&&entry.size>MAX_MARKDOWN_BYTES)invalid('SKILL.md 或部署清单过大');
    const receive = (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > entry.size || size > MAX_EXPANDED_BYTES) invalid('ZIP 解压大小与目录不符');
      for(const byte of chunk)crc=crcTable[(crc^byte)&255]^(crc>>>8);
      if(capture)chunks.push(chunk.slice());
    };
    try {
      const compressed = bytes.subarray(entry.offset, entry.offset + entry.compressed);
      if (entry.method === 0) receive(compressed);
      else {
        const stream = new Inflate(receive);
        for (let i = 0; i < compressed.length; i += 1024) stream.push(compressed.subarray(i, i + 1024), i + 1024 >= compressed.length);
        if (!compressed.length) stream.push(new Uint8Array(), true);
      }
    } catch (error) { if (error instanceof ApiError) throw error; invalid('ZIP 压缩内容损坏'); }
    if (size !== entry.size) invalid('ZIP 文件大小不符');
    if(((crc^0xffffffff)>>>0)!==entry.crc)invalid('ZIP 文件校验失败');
    if(capture) {
      const content=new Uint8Array(size);let at=0;for(const chunk of chunks){content.set(chunk,at);at+=chunk.length;}
      let text:string;try{text=utf8.decode(content);}catch{invalid('SKILL.md 或部署清单必须为 UTF-8 文本');}
      if(entry===skill)markdown=text!;else captured.set(entry.name,text!);
    }
  }
  let manifestMetadata:Record<string,unknown>={},declaredVersion:string|undefined;
  for(const path of candidates) {
    const text=captured.get(path);if(text===undefined)continue;
    let value:unknown;try{value=parse(text.replace(/^\uFEFF/,''),{maxAliasCount:20});}catch{if(path.endsWith('/manifest.yaml')||path==='manifest.yaml')continue;invalid('SkillGo 部署清单 YAML 格式无效');}
    if(!value||typeof value!=='object'||Array.isArray(value)){if(path.endsWith('manifest.yaml')&&!path.endsWith('manifest.skillgo.yaml'))continue;invalid('SkillGo 部署清单须为对象');}
    const manifest=value as Record<string,unknown>;
    if((path.endsWith('/manifest.yaml')||path==='manifest.yaml')&&!String(manifest.apiVersion??'').startsWith('skillgo.io/'))continue;
    if(manifest.metadata&&typeof manifest.metadata==='object'&&!Array.isArray(manifest.metadata))manifestMetadata=manifest.metadata as Record<string,unknown>;
    const version=manifestMetadata.version;
    if(version!==undefined){if(typeof version==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))declaredVersion=version;else warnings.push('包内版本不是 Hub 的数字 x.y.z 格式，将自动分配版本；原始清单保留。');}
    break;
  }
  const parent=root.split('/').filter(Boolean).at(-1),name=typeof manifestMetadata.displayName==='string'?manifestMetadata.displayName:undefined;
  const metadata=parseSkill(markdown,{preferredName:name,fallbackName:typeof manifestMetadata.name==='string'?manifestMetadata.name:parent&&!['skill','skills'].includes(parent.toLowerCase())?parent:undefined,defaultName:options.filename?.replace(/\.zip$/i,''),preferredSlug:typeof manifestMetadata.name==='string'?manifestMetadata.name:undefined});
  warnings.push(...metadata.warnings);
  return {root,entryPath:skill.name,markdown,metadata,declaredVersion,warnings,files};
}

export function markdownPackage(markdown: string) {
  return zipSync({ 'SKILL.md': strToU8(markdown) }, { level: 6, mtime: new Date(2000, 0, 1) });
}
export function packageTemplate() {
  return zipSync({
    'my-skill/SKILL.md': strToU8('---\nname: my-skill\ndescription: Describe what this skill does and when to use it.\n---\n\n# My Skill\n\n## Workflow\n1. Understand the goal.\n2. Complete the task.\n3. Verify the result.\n'),
    'my-skill/references/example.md': strToU8('# Reference\n\nReplace with your supporting documentation.\n'),
  }, { level: 6, mtime: new Date(2000, 0, 1) });
}
