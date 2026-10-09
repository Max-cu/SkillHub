import { Inflate, strToU8, zipSync } from 'fflate';
import { ApiError, parseSkill } from './domain.ts';

export const MAX_ZIP_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 200;
export type PackageInfo = { root: string; markdown: string; files: { path: string; size: number }[] };
const invalid = (message: string): never => { throw new ApiError(400, 'invalid_package', message); };
const utf8 = new TextDecoder('utf-8', { fatal: true });

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function safePath(name: string) {
  const path = name.endsWith('/') ? name.slice(0, -1) : name;
  if (!path || path.length > 240 || /[\\:\x00-\x1f\x7f]/.test(path) || path.startsWith('/')) invalid('ZIP 包含不安全的文件路径');
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) invalid('ZIP 包含不安全的文件路径');
  }
  return path;
}

// Read central and local headers before inflating. No archive contents are executed or extracted to disk.
export function inspectPackage(bytes: Uint8Array): PackageInfo {
  if (bytes.length > MAX_ZIP_BYTES) throw new ApiError(413, 'package_too_large', 'ZIP 最大为 5 MB');
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
  if (!count || count > MAX_FILES || directoryOffset + directorySize !== end) invalid('ZIP 最多包含 200 个条目，且目录必须完整');
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
    let name: string;
    try { name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength)); } catch { invalid('ZIP 文件名必须为 UTF-8'); }
    const normalized = safePath(name!), folded = normalized.normalize('NFC').toLowerCase();
    if (names.has(folded)) invalid('ZIP 包含重复或大小写冲突的路径');
    names.add(folded);
    const mode = (u32(p + 38) >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000) invalid('ZIP 不允许符号链接或特殊文件');
    const directory = name!.endsWith('/');
    if ((mode === 0x4000 && !directory) || (directory && size !== 0)) invalid('ZIP 目录条目无效');
    expanded += size;
    if (size > MAX_ZIP_BYTES || expanded > MAX_EXPANDED_BYTES) throw new ApiError(413, 'expanded_package_too_large', '解压总量最大 20 MB，单文件最大 5 MB');
    if (offset + 30 > directoryOffset || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) invalid('ZIP 本地文件头不匹配');
    const localNameLength = u16(offset + 26), localExtraLength = u16(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    if (start + compressed > directoryOffset || localNameLength !== nameLength) invalid('ZIP 文件范围无效');
    for (let n = 0; n < nameLength; n++) if (bytes[offset + 30 + n] !== bytes[p + 46 + n]) invalid('ZIP 本地文件名不匹配');
    if (!(flags & 8) && (u32(offset + 14) !== u32(p + 16) || u32(offset + 18) !== compressed || u32(offset + 22) !== size)) invalid('ZIP 文件大小或校验和不匹配');
    entries.push({ name: name!, offset: start, compressed, size, crc: u32(p + 16), method, directory });
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (p !== end) invalid('ZIP 目录长度无效');
  const ordered = [...entries].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < ordered.length; i++) if (ordered[i].offset < ordered[i - 1].offset + ordered[i - 1].compressed) invalid('ZIP 文件范围重叠');
  const meaningful = entries.filter(e => !e.name.startsWith('__MACOSX/') && e.name.split('/').at(-1) !== '.DS_Store');
  const skillFiles = meaningful.filter(e => !e.directory && e.name.split('/').at(-1) === 'SKILL.md');
  if (skillFiles.length !== 1) invalid('ZIP 必须且只能包含一个 SKILL.md');
  const skill = skillFiles[0], root = skill.name.slice(0, -'SKILL.md'.length);
  if (root && root.slice(0, -1).includes('/')) invalid('SKILL.md 应位于根目录或单一顶层文件夹');
  if (meaningful.some(e => root && e.name !== root && !e.name.startsWith(root))) invalid('ZIP 所有文件应位于同一个技能文件夹');
  const files = meaningful.filter(e => !e.directory).map(e => ({ path: e.name.slice(root.length), size: e.size }));
  for (const file of files) for (const other of files) if (other.path.startsWith(file.path + '/')) invalid('ZIP 中的文件与文件夹路径冲突');
  let markdown = '';
  // Validate every resource, including actual expanded byte counts and CRC, so downloads preserve a valid complete package.
  for (const entry of entries) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const receive = (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > entry.size || size > MAX_ZIP_BYTES) invalid('ZIP 解压大小与目录不符');
      chunks.push(chunk.slice());
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
    const content = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { content.set(chunk, at); at += chunk.length; }
    if (crc32(content) !== entry.crc) invalid('ZIP 文件校验失败');
    if (entry === skill) {
      try { markdown = utf8.decode(content); } catch { invalid('SKILL.md 必须为 UTF-8 文本'); }
      parseSkill(markdown);
    }
  }
  return { root, markdown, files };
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
