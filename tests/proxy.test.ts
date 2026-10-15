/**
 * Tests for proxy.ts (admin Basic auth, Referer gate, route-category rate
 * limiting) and its pure helpers in lib/proxy-utils.ts.
 */
import { NextRequest } from 'next/server';
import { parseBasicAuth, getRouteCategory, matchesRoute } from '@/lib/proxy-utils';
import { rateLimiter } from '@/lib/rate-limiter';

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

describe('parseBasicAuth', () => {
  it('splits on the first colon only, so passwords may contain ":"', () => {
    expect(parseBasicAuth(`Basic ${b64('admin:pa:ss:word')}`)).toEqual({
      username: 'admin',
      password: 'pa:ss:word',
    });
  });

  it('handles empty password and trailing colon', () => {
    expect(parseBasicAuth(`Basic ${b64('admin:')}`)).toEqual({ username: 'admin', password: '' });
    expect(parseBasicAuth(`Basic ${b64('admin:x:')}`)).toEqual({ username: 'admin', password: 'x:' });
  });

  it('rejects malformed headers', () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth('Bearer abc')).toBeNull();
    expect(parseBasicAuth('Basic')).toBeNull();
    expect(parseBasicAuth(`Basic ${b64('nocolon')}`)).toBeNull();
  });
});

describe('getRouteCategory', () => {
  it('collapses dynamic segments into one bucket per route group', () => {
    expect(getRouteCategory('/api/preview/abc-123')).toBe('api:preview');
    expect(getRouteCategory('/api/preview/def-456')).toBe('api:preview');
    expect(getRouteCategory('/api/datasets/11111111-1111-1111-1111-111111111111')).toBe('api:datasets');
    expect(getRouteCategory('/api/datasets/x/extra/segments')).toBe('api:datasets');
    expect(getRouteCategory('/api/share/xyz')).toBe('api:share');
  });

  it('keeps distinct static routes separate', () => {
    expect(getRouteCategory('/api/search')).toBe('api:search');
    expect(getRouteCategory('/api/mcp')).toBe('api:mcp');
    expect(getRouteCategory('/api/sources/validate')).toBe('api:sources:validate');
    expect(getRouteCategory('/api/sources/submit')).toBe('api:sources:submit');
  });

  it('collapses unknown paths into one bucket', () => {
    expect(getRouteCategory('/api/random-1')).toBe('api:other');
    expect(getRouteCategory('/api/random-2/zzz')).toBe('api:other');
  });
});

describe('matchesRoute', () => {
  it('matches exact and nested paths but not prefixes of other names', () => {
    expect(matchesRoute('/api/health', '/api/health')).toBe(true);
    expect(matchesRoute('/api/health/db', '/api/health')).toBe(true);
    expect(matchesRoute('/api/healthz', '/api/health')).toBe(false);
  });
});

describe('proxy()', () => {
  let proxy: (req: NextRequest) => Response;

  beforeAll(() => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 's3cret:with:colons';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      proxy = require('@/proxy').proxy;
    });
  });

  afterAll(() => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
  });

  // proxy.ts imports '@/lib/rate-limiter' via a relative path; isolateModules
  // gives it its own instance, so clear by sending fresh IPs per test instead.
  let ipCounter = 0;
  const nextIp = () => `203.0.113.${++ipCounter}`;

  const req = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(`https://findria.test${path}`, { headers });

  describe('admin auth', () => {
    it.each(['/admin', '/admin/queue', '/api/admin/submit', '/api/admin/search-arcgis'])(
      'returns 401 without credentials for %s',
      (path) => {
        const res = proxy(req(path, { 'cf-connecting-ip': nextIp() }));
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toContain('Basic');
      }
    );

    it('accepts a password containing ":"', () => {
      const res = proxy(
        req('/api/admin/submit', {
          authorization: `Basic ${b64('admin:s3cret:with:colons')}`,
          'cf-connecting-ip': nextIp(),
        })
      );
      expect(res.status).toBe(200);
    });

    it('rejects a truncated password (old split(":") behaviour)', () => {
      const res = proxy(
        req('/admin', { authorization: `Basic ${b64('admin:s3cret')}`, 'cf-connecting-ip': nextIp() })
      );
      expect(res.status).toBe(401);
    });

    it('rejects wrong username', () => {
      const res = proxy(
        req('/admin', { authorization: `Basic ${b64('root:s3cret:with:colons')}`, 'cf-connecting-ip': nextIp() })
      );
      expect(res.status).toBe(401);
    });

    it('locks out an IP after repeated failed logins', () => {
      const ip = nextIp();
      const bad = { authorization: `Basic ${b64('admin:wrong')}`, 'cf-connecting-ip': ip };
      for (let i = 0; i < 10; i++) {
        expect(proxy(req('/admin', bad)).status).toBe(401);
      }
      expect(proxy(req('/admin', bad)).status).toBe(429);
      // Even correct credentials are refused during lockout
      const good = { authorization: `Basic ${b64('admin:s3cret:with:colons')}`, 'cf-connecting-ip': ip };
      expect(proxy(req('/admin', good)).status).toBe(429);
    });
  });

  describe('API gating', () => {
    it('requires Referer/Origin for normal API routes', () => {
      expect(proxy(req('/api/search', { 'cf-connecting-ip': nextIp() })).status).toBe(403);
    });

    it('exempts /api/mcp from the Referer check but still rate limits it', () => {
      const ip = nextIp();
      const first = proxy(req('/api/mcp', { 'cf-connecting-ip': ip }));
      expect(first.status).toBe(200);
      expect(first.headers.get('x-ratelimit-limit')).toBe('30');
      let last: Response = first;
      for (let i = 0; i < 30; i++) last = proxy(req('/api/mcp', { 'cf-connecting-ip': ip }));
      expect(last.status).toBe(429);
    });

    it('does not exempt look-alike paths such as /api/mcpx', () => {
      expect(proxy(req('/api/mcpx', { 'cf-connecting-ip': nextIp() })).status).toBe(403);
    });

    it('shares one rate-limit bucket across /api/preview/<id> paths', () => {
      const ip = nextIp();
      const headers = { 'cf-connecting-ip': ip, referer: 'https://findria.test/' };
      let res: Response | undefined;
      for (let i = 0; i < 60; i++) {
        res = proxy(req(`/api/preview/id-${i}`, headers));
        expect(res.status).toBe(200);
      }
      res = proxy(req('/api/preview/brand-new-id', headers));
      expect(res.status).toBe(429);
    });
  });
});

afterAll(() => {
  rateLimiter.clear();
});
