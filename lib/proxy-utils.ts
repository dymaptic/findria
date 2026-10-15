/**
 * Pure helpers used by proxy.ts (kept separate so they can be unit-tested
 * without the Next.js request pipeline).
 */

/**
 * Parse an `Authorization: Basic ...` header value.
 * Splits on the FIRST colon only (RFC 7617: user-id cannot contain ':', the
 * password can).
 */
export function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header) return null;
  const match = header.match(/^Basic\s+(\S+)\s*$/i);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

/** Top-level API route groups that exist under app/api/. Anything else shares one bucket. */
const KNOWN_API_GROUPS = new Set([
  'admin',
  'chat',
  'coverage',
  'datasets',
  'health',
  'mcp',
  'overture',
  'preview',
  'search',
  'share',
  'sources',
]);

/** Sub-routes that get their own bucket because their cost profiles differ. */
const SPLIT_SUBROUTES: Record<string, Set<string>> = {
  sources: new Set(['validate', 'submit']),
};

/**
 * Map a pathname to a rate-limit bucket category. Dynamic segments are
 * dropped, so /api/preview/<id> and /api/preview/<other-id> share one bucket
 * (and likewise /api/datasets/<id>). Unknown paths collapse into a single
 * "api:other" bucket so random paths cannot mint unlimited fresh buckets.
 */
export function getRouteCategory(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] !== 'api') return 'page';
  const group = (segs[1] || '').toLowerCase();
  if (!KNOWN_API_GROUPS.has(group)) return 'api:other';
  const sub = (segs[2] || '').toLowerCase();
  if (SPLIT_SUBROUTES[group]?.has(sub)) return `api:${group}:${sub}`;
  return `api:${group}`;
}

/** True if `pathname` is exactly `route` or below it (`route/...`). */
export function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + '/');
}
