import net from 'node:net';

/**
 * SSRF policy for AgentHub invoke (ChemBuddy).
 *
 * `AGENTHUB_UPSTREAM_ALLOWLIST` is a comma-separated list of host, host:port, or CIDR.
 * An empty list never makes an outbound call.
 *
 * After the URL is parsed (http/https only, no userinfo) and DNS has run:
 * - Always deny loopback (127.0.0.0/8, ::1), unspecified (0.0.0.0/8, ::),
 *   link-local (169.254.0.0/16, fe80::/10), multicast, 240.0.0.0/4,
 *   NAT64 64:ff9b::/96, and cloud metadata addresses
 *   (169.254.169.254, 169.254.170.2, 100.100.100.200, fd00:ec2::254).
 *   A CIDR or host entry cannot override these. localhost and known metadata
 *   names are rejected before connect.
 * - RFC1918 (10/8, 172.16/12, 192.168/16), IPv6 ULA (fc00::/7) and CGNAT
 *   (100.64.0.0/10) are denied by default. They are allowed only when:
 *   1. the URL host is an explicit allowlist host (ChemBuddy: an internal
 *      runtime name may resolve to a private address), or
 *   2. that resolved address sits in an allowlist CIDR.
 *   A hostname that is not listed is allowed only when every resolved address
 *   is inside an allowlist CIDR. If any address is always-deny, the whole host
 *   is rejected (no connect to a "good" sibling record).
 *
 * Ports 80 and 443 are allowed for an authorized host. Any other port must be
 * declared on a host:port entry. CIDR-only authorization is limited to 80/443.
 * IPv6 entries with a port use [addr]:port.
 */

const METADATA_NAMES = new Set([
  'metadata.google.internal',
  'metadata.google.com',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
]);

const alwaysDeny = new net.BlockList();
alwaysDeny.addSubnet('0.0.0.0', 8, 'ipv4');
alwaysDeny.addSubnet('127.0.0.0', 8, 'ipv4');
alwaysDeny.addSubnet('169.254.0.0', 16, 'ipv4');
alwaysDeny.addSubnet('224.0.0.0', 4, 'ipv4');
alwaysDeny.addSubnet('240.0.0.0', 4, 'ipv4');
alwaysDeny.addAddress('100.100.100.200', 'ipv4');
alwaysDeny.addAddress('169.254.170.2', 'ipv4');
alwaysDeny.addAddress('::', 'ipv6');
alwaysDeny.addAddress('::1', 'ipv6');
alwaysDeny.addSubnet('fe80::', 10, 'ipv6');
alwaysDeny.addSubnet('ff00::', 8, 'ipv6');
alwaysDeny.addSubnet('64:ff9b::', 96, 'ipv6');
alwaysDeny.addAddress('fd00:ec2::254', 'ipv6');

const privateRange = new net.BlockList();
privateRange.addSubnet('10.0.0.0', 8, 'ipv4');
privateRange.addSubnet('172.16.0.0', 12, 'ipv4');
privateRange.addSubnet('192.168.0.0', 16, 'ipv4');
privateRange.addSubnet('100.64.0.0', 10, 'ipv4');
privateRange.addSubnet('fc00::', 7, 'ipv6');

export type AddressClass = 'deny' | 'private' | 'public' | 'invalid';
export type Allowlist = { hosts: Map<string, Set<number>>; cidrs: net.BlockList; cidrCount: number };
export type DnsLookup = (hostname: string) => Promise<string[]>;
export type VetReason = 'syntax' | 'protocol' | 'userinfo' | 'metadata' | 'host' | 'port' | 'dns' | 'address';
export type VetResult = { ok: true; url: URL; addresses: string[] } | { ok: false; reason: VetReason };

export function emptyAllowlist(): Allowlist {
  return { hosts: new Map(), cidrs: new net.BlockList(), cidrCount: 0 };
}
export function allowlistIsEmpty(allowlist: Allowlist) {
  return allowlist.hosts.size === 0 && allowlist.cidrCount === 0;
}

function familyOf(ip: string): 'ipv4' | 'ipv6' | null {
  const kind = net.isIP(ip);
  if (kind === 4) return 'ipv4';
  if (kind === 6) return 'ipv6';
  return null;
}
export function classifyAddress(ip: string): AddressClass {
  const family = familyOf(ip);
  if (!family) return 'invalid';
  if (alwaysDeny.check(ip, family)) return 'deny';
  if (privateRange.check(ip, family)) return 'private';
  return 'public';
}
function bareHost(hostname: string) {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}
export function canonicalHost(host: string): string | null {
  let input = host.trim().toLowerCase();
  if (!input || input.includes('/') || input.includes('@') || input.includes('*') || input.includes('%') || input.includes(' ')) return null;
  if (input.endsWith('.')) input = input.slice(0, -1);
  if (!input) return null;
  const authority = input.includes(':') && !input.startsWith('[') ? `[${input}]` : input;
  try {
    const url = new URL(`http://${authority}/`);
    return bareHost(url.hostname) || null;
  } catch {
    return null;
  }
}
function parseCidr(entry: string) {
  const slash = entry.lastIndexOf('/');
  if (slash <= 0) return null;
  const address = entry.slice(0, slash);
  const prefix = Number(entry.slice(slash + 1));
  const kind = net.isIP(address);
  if (!kind) return null;
  const max = kind === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > max) return null;
  return { address, prefix, family: kind === 4 ? 'ipv4' as const : 'ipv6' as const };
}
function splitHostPort(entry: string): { host: string; port?: number } | null {
  if (entry.startsWith('[')) {
    const match = /^\[([^\]]+)](?::(\d{1,5}))?$/.exec(entry);
    if (!match) return null;
    if (match[2] === undefined) return { host: match[1] };
    const port = Number(match[2]);
    if (port < 1 || port > 65535) return null;
    return { host: match[1], port };
  }
  const match = /^(.*):(\d{1,5})$/.exec(entry);
  if (match && !match[1].includes(':')) {
    const port = Number(match[2]);
    if (port < 1 || port > 65535) return null;
    return { host: match[1], port };
  }
  return { host: entry };
}
export function parseAllowlist(raw: string | undefined): Allowlist {
  const allowlist = emptyAllowlist();
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim().toLowerCase();
    if (!entry || entry.includes('://') || entry.includes('*') || entry.includes('@') || entry.includes('%')) continue;
    if (entry.includes('/')) {
      const cidr = parseCidr(entry);
      if (!cidr) continue;
      allowlist.cidrs.addSubnet(cidr.address, cidr.prefix, cidr.family);
      allowlist.cidrCount += 1;
      continue;
    }
    const split = splitHostPort(entry);
    if (!split || !split.host) continue;
    const host = canonicalHost(split.host);
    if (!host) continue;
    const ports = allowlist.hosts.get(host) ?? new Set<number>();
    if (split.port !== undefined) ports.add(split.port);
    allowlist.hosts.set(host, ports);
  }
  return allowlist;
}
function hasUserinfo(raw: string, url: URL) {
  if (url.username || url.password) return true;
  const scheme = raw.indexOf('://');
  if (scheme < 0) return false;
  const rest = raw.slice(scheme + 3);
  const slash = rest.search(/[/?#]/);
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  return authority.includes('@');
}
function effectivePort(url: URL) {
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return port;
  }
  if (url.protocol === 'http:') return 80;
  if (url.protocol === 'https:') return 443;
  return null;
}
function metadataName(host: string) {
  return METADATA_NAMES.has(host) || host === 'localhost' || host.endsWith('.localhost');
}
function inCidr(ip: string, allowlist: Allowlist) {
  if (allowlist.cidrCount === 0) return false;
  const family = familyOf(ip);
  return family ? allowlist.cidrs.check(ip, family) : false;
}
function portAllowed(host: string, port: number, allowlist: Allowlist) {
  if (port === 80 || port === 443) return true;
  return allowlist.hosts.get(host)?.has(port) === true;
}

export async function vetUpstream(raw: string, allowlist: Allowlist, lookup: DnsLookup): Promise<VetResult> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) return { ok: false, reason: 'syntax' };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'syntax' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  if (hasUserinfo(raw, url)) return { ok: false, reason: 'userinfo' };
  const host = bareHost(url.hostname);
  if (!host || host.includes('%')) return { ok: false, reason: 'syntax' };
  if (metadataName(host)) return { ok: false, reason: 'metadata' };
  const port = effectivePort(url);
  if (!port) return { ok: false, reason: 'port' };
  const listed = allowlist.hosts.has(host);
  if (!listed && allowlist.cidrCount === 0) return { ok: false, reason: 'host' };
  if (!portAllowed(host, port, allowlist)) return { ok: false, reason: 'port' };
  url.hash = '';
  let addresses: string[];
  if (familyOf(host)) addresses = [host];
  else {
    try { addresses = await lookup(host); } catch { return { ok: false, reason: 'dns' }; }
    if (!addresses.length) return { ok: false, reason: 'dns' };
  }
  for (const address of addresses) {
    const kind = classifyAddress(address);
    if (kind === 'deny' || kind === 'invalid') return { ok: false, reason: 'address' };
    if (kind === 'private' && !listed && !inCidr(address, allowlist)) return { ok: false, reason: 'address' };
    if (kind === 'public' && !listed && !inCidr(address, allowlist)) return { ok: false, reason: 'address' };
  }
  if (!listed && addresses.some(address => !inCidr(address, allowlist))) return { ok: false, reason: 'address' };
  return { ok: true, url, addresses };
}
