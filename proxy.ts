import crypto from 'crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { rateLimiter } from './lib/rate-limiter';
import { parseBasicAuth, getRouteCategory, matchesRoute } from './lib/proxy-utils';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.warn('WARNING: ADMIN_USERNAME and/or ADMIN_PASSWORD not set. Admin area will be inaccessible.');
}

function timingSafeEqual(a: string, b: string): boolean {
  // Compare fixed-length digests so neither content nor length leaks via timing
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function checkBasicAuth(request: NextRequest): boolean {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return false;
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'));
  if (!credentials) {
    return false;
  }

  // Evaluate both comparisons (no short-circuit) to avoid leaking which part failed
  const userOk = timingSafeEqual(credentials.username, ADMIN_USERNAME);
  const passOk = timingSafeEqual(credentials.password, ADMIN_PASSWORD);
  return userOk && passOk;
}

// Rate limit configuration per endpoint pattern
const RATE_LIMITS: { pattern: RegExp; limit: number; windowMs: number }[] = [
  // Most expensive endpoints (Claude + OpenAI + DB)
  { pattern: /^\/api\/search$/, limit: 30, windowMs: 60_000 },
  { pattern: /^\/api\/mcp$/, limit: 30, windowMs: 60_000 },
  // Triggers outbound requests to user-supplied servers
  { pattern: /^\/api\/sources\//, limit: 10, windowMs: 60_000 },
  // Moderately expensive (DuckDB/ArcGIS queries)
  { pattern: /^\/api\/preview\//, limit: 60, windowMs: 60_000 },
  // Default for other API routes
  { pattern: /^\/api\//, limit: 120, windowMs: 60_000 },
];

// Failed admin logins allowed per IP per window before temporary lockout
const ADMIN_AUTH_FAIL_LIMIT = 10;
const ADMIN_AUTH_FAIL_WINDOW_MS = 15 * 60_000;

/**
 * Client IP for rate limiting.
 *
 * SECURITY: cf-connecting-ip / x-forwarded-for are only trustworthy when the
 * origin accepts traffic exclusively from Cloudflare (firewall / App Service
 * access restrictions to Cloudflare IP ranges). If the origin is reachable
 * directly, clients can forge these headers and pick their own bucket.
 */
function getClientIp(request: NextRequest): string {
  // Prefer Cloudflare's header (set by Cloudflare; see trust note above)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }

  // Fallback to x-forwarded-for (set by reverse proxies)
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback for local development
  return '127.0.0.1';
}

function getRateLimit(pathname: string): { limit: number; windowMs: number } {
  for (const config of RATE_LIMITS) {
    if (config.pattern.test(pathname)) {
      return { limit: config.limit, windowMs: config.windowMs };
    }
  }
  // Shouldn't reach here given the catch-all pattern, but just in case
  return { limit: 120, windowMs: 60_000 };
}

// API routes exempt from referer/origin checks
// (called by non-browser clients with their own auth or public by design)
const EXEMPT_API_ROUTES = [
  '/api/health',
  '/api/mcp',             // MCP protocol clients (still rate limited below)
];

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Admin area auth check (pages and API routes)
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const ip = getClientIp(request);
    const failKey = `${ip}:admin-auth-fail`;

    if (rateLimiter.isLimited(failKey, ADMIN_AUTH_FAIL_LIMIT)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    if (!checkBasicAuth(request)) {
      // Only count attempts that actually presented credentials, so the
      // browser's initial unauthenticated probe doesn't burn the budget.
      if (request.headers.get('authorization')) {
        rateLimiter.check(failKey, Number.MAX_SAFE_INTEGER, ADMIN_AUTH_FAIL_WINDOW_MS);
      }
      return new NextResponse('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="Admin Area"',
          'Content-Type': 'text/plain',
        },
      });
    }
    // Authenticated admin routes pass through without rate limiting
    return NextResponse.next();
  }

  // Require Referer or Origin header for non-exempt API routes
  if (pathname.startsWith('/api') && !EXEMPT_API_ROUTES.some((route) => matchesRoute(pathname, route))) {
    const referer = request.headers.get('referer');
    const origin = request.headers.get('origin');

    if (!referer && !origin) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }
  }

  const ip = getClientIp(request);
  const { limit, windowMs } = getRateLimit(pathname);

  // Key on IP + route category (dynamic segments stripped), not the full
  // pathname — otherwise /api/preview/<id> gets a fresh bucket per id.
  const key = `${ip}:${getRouteCategory(pathname)}`;

  const { allowed, remaining, resetAt } = rateLimiter.check(key, limit, windowMs);

  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Too many requests', retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
        },
      }
    );
  }

  // Add rate limit headers to successful responses
  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(limit));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
};
