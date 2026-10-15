/**
 * SSRF-hardened fetch for user-supplied URLs.
 *
 * Every outbound request whose URL (or any part of it) originates from a user,
 * or from content fetched from a user-supplied server (DCAT feeds, org search
 * results, ArcGIS folder listings), must go through `safeFetch`.
 *
 * Guarantees per hop:
 *   - scheme is http: or https:
 *   - hostname is normalised by the WHATWG URL parser (so decimal / octal / hex
 *     IPv4 literals such as `2130706433`, `0177.0.0.1`, `0x7f.1` become
 *     `127.0.0.1`) and IPv6 brackets are stripped before classification
 *   - IP literals are classified directly; hostnames are resolved with
 *     dns.lookup({ all: true }) and rejected if ANY returned address is
 *     private / reserved
 *   - redirects are followed manually (`redirect: 'manual'`) and each hop is
 *     re-validated, up to MAX_REDIRECTS
 *   - the whole request chain is bounded by a timeout
 *
 * KNOWN LIMITATION (DNS rebinding / TOCTOU): we resolve the hostname, check the
 * addresses, then hand the hostname to fetch(), which resolves it again. A
 * malicious authoritative DNS server with a very low TTL could answer with a
 * public address for our check and a private one for the connection. Closing
 * this gap requires pinning the connection to the vetted IP (e.g. an undici
 * `Agent` with a custom `connect.lookup`), which needs the `undici` package as
 * a direct dependency. Until then, network-level egress controls (no route
 * from the app to internal ranges / metadata endpoints) are the backstop.
 */
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 5;

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'blocked_protocol'
  | 'blocked_address'
  | 'dns_failure'
  | 'too_many_redirects'
  | 'bad_redirect';

/** Error raised when a URL is refused before/while fetching. Message is safe to log, not to echo. */
export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

// ─── IP classification ──────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function v4Cidr(base: string, bits: number): [number, number] {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [(ipv4ToInt(base) & mask) >>> 0, mask];
}

const BLOCKED_V4: Array<[number, number]> = [
  v4Cidr('0.0.0.0', 8), // "this" network
  v4Cidr('10.0.0.0', 8), // private
  v4Cidr('100.64.0.0', 10), // carrier-grade NAT
  v4Cidr('127.0.0.0', 8), // loopback
  v4Cidr('169.254.0.0', 16), // link-local (cloud metadata)
  v4Cidr('172.16.0.0', 12), // private
  v4Cidr('192.0.0.0', 24), // IETF protocol assignments
  v4Cidr('192.0.2.0', 24), // TEST-NET-1
  v4Cidr('192.88.99.0', 24), // 6to4 relay anycast
  v4Cidr('192.168.0.0', 16), // private
  v4Cidr('198.18.0.0', 15), // benchmarking
  v4Cidr('198.51.100.0', 24), // TEST-NET-2
  v4Cidr('203.0.113.0', 24), // TEST-NET-3
  v4Cidr('224.0.0.0', 4), // multicast
  v4Cidr('240.0.0.0', 4), // reserved + broadcast
];

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([net, mask]) => ((n & mask) >>> 0) === net);
}

/** Expand an IPv6 address (no brackets, no zone) to 8 16-bit groups. Returns null if malformed. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip;
  // Trailing embedded IPv4 (e.g. ::ffff:1.2.3.4)
  const v4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    if (isIP(v4Match[1]!) !== 4) return null;
    const n = ipv4ToInt(v4Match[1]!);
    addr =
      addr.slice(0, -v4Match[1]!.length) +
      ((n >>> 16) & 0xffff).toString(16) +
      ':' +
      (n & 0xffff).toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const nums = groups.map((g) => parseInt(g, 16));
  if (nums.length !== 8 || nums.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff)) return null;
  return nums;
}

function groupsToV4(hi: number, lo: number): string {
  return `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
}

function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip.split('%')[0]!);
  if (!g) return true; // unparseable → refuse

  const allZeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);

  // :: (unspecified) and ::1 (loopback)
  if (allZeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true;
  // ::ffff:a.b.c.d (IPv4-mapped) → classify embedded v4
  if (allZeroPrefix(5) && g[5] === 0xffff) return isBlockedIPv4(groupsToV4(g[6]!, g[7]!));
  // ::a.b.c.d (deprecated IPv4-compatible) → classify embedded v4
  if (allZeroPrefix(6)) return isBlockedIPv4(groupsToV4(g[6]!, g[7]!));
  // 64:ff9b::/96 NAT64 → classify embedded v4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4(groupsToV4(g[6]!, g[7]!));
  }
  // 2002::/16 6to4 → classify embedded v4 (groups 1-2)
  if (g[0] === 0x2002) return isBlockedIPv4(groupsToV4(g[1]!, g[2]!));
  // fc00::/7 unique-local
  if ((g[0]! & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfe80) return true;
  // fec0::/10 deprecated site-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true;
  // ff00::/8 multicast
  if ((g[0]! & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 documentation
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  // 100::/64 discard-only
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;

  return false;
}

/** Strip surrounding IPv6 brackets, as found in URL.hostname. */
export function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * True if `ip` (an IP literal, brackets allowed) is private, loopback,
 * link-local, multicast or otherwise reserved. Non-IP input returns true
 * (fail closed).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const addr = stripBrackets(ip.trim());
  const family = isIP(addr.split('%')[0]!);
  if (family === 4) return isBlockedIPv4(addr);
  if (family === 6) return isBlockedIPv6(addr);
  return true;
}

// ─── URL validation ─────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

/**
 * Synchronous pre-check: scheme, parseability, and IP-literal / obvious
 * hostname blocks. Does NOT resolve DNS — use `assertPublicUrl` for that.
 */
export function checkUrlSyntax(rawUrl: string | URL): URL {
  let parsed: URL;
  try {
    parsed = typeof rawUrl === 'string' ? new URL(rawUrl) : new URL(rawUrl.href);
  } catch {
    throw new SafeFetchError('invalid_url', 'Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SafeFetchError('blocked_protocol', 'Only HTTP and HTTPS URLs are allowed');
  }
  // URL parser has already normalised numeric IPv4 forms and lower-cased the host.
  const host = stripBrackets(parsed.hostname).replace(/\.$/, '');
  if (!host) throw new SafeFetchError('invalid_url', 'Invalid URL');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    throw new SafeFetchError('blocked_address', 'URLs pointing to private or reserved addresses are not allowed');
  }
  if (isIP(host.split('%')[0]!) && isPrivateOrReservedIp(host)) {
    throw new SafeFetchError('blocked_address', 'URLs pointing to private or reserved addresses are not allowed');
  }
  return parsed;
}

/**
 * Full check: syntax + DNS resolution. Rejects if ANY resolved address is
 * private/reserved. Returns the parsed URL.
 */
export async function assertPublicUrl(rawUrl: string | URL): Promise<URL> {
  const parsed = checkUrlSyntax(rawUrl);
  const host = stripBrackets(parsed.hostname).replace(/\.$/, '');
  if (isIP(host.split('%')[0]!)) return parsed; // literal already classified

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError('dns_failure', 'Could not resolve host');
  }
  if (!addresses || addresses.length === 0) {
    throw new SafeFetchError('dns_failure', 'Could not resolve host');
  }
  if (addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    throw new SafeFetchError('blocked_address', 'URLs pointing to private or reserved addresses are not allowed');
  }
  return parsed;
}

// ─── Fetch ──────────────────────────────────────────────────────────────────

export interface SafeFetchOptions extends Omit<RequestInit, 'redirect' | 'signal'> {
  /** Total time budget for the whole redirect chain. */
  timeoutMs?: number;
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * fetch() replacement for user-controlled URLs. See module docs.
 * Throws SafeFetchError for refused URLs; network errors propagate as-is.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = MAX_REDIRECTS, ...init } = options;
  const signal = AbortSignal.timeout(timeoutMs);

  let current = (await assertPublicUrl(rawUrl)).href;
  let method = init.method;
  let body = init.body;

  for (let hop = 0; ; hop++) {
    const response = await fetch(current, { ...init, method, body, redirect: 'manual', signal });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    // Release the redirect response's socket
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }

    if (hop >= maxRedirects) {
      throw new SafeFetchError('too_many_redirects', 'Too many redirects');
    }

    const location = response.headers?.get('location');
    if (!location) {
      throw new SafeFetchError('bad_redirect', 'Redirect without Location header');
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new SafeFetchError('bad_redirect', 'Invalid redirect target');
    }
    current = (await assertPublicUrl(next)).href;

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method && method.toUpperCase() === 'POST')) {
      method = 'GET';
      body = undefined;
    }
  }
}

/**
 * Read at most `maxBytes` of a response body as UTF-8 text (for HTML scraping
 * where we only need the <head>). Falls back to response.text() if the body
 * is not a stream.
 */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  const stream = response.body;
  if (!stream || typeof stream.getReader !== 'function') {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = '';
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return out + decoder.decode();
}
