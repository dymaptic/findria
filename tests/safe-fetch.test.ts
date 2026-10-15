/**
 * Tests for lib/safe-fetch.ts: IP classification, URL checks, DNS checks,
 * and manual redirect re-validation.
 */
import { lookup } from 'node:dns/promises';
import {
  isPrivateOrReservedIp,
  checkUrlSyntax,
  assertPublicUrl,
  safeFetch,
  SafeFetchError,
} from '@/lib/safe-fetch';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
const mockLookup = lookup as unknown as jest.Mock;

const PUBLIC_V4 = '93.184.216.34';

function hostResolvesTo(map: Record<string, string[]>) {
  mockLookup.mockImplementation(async (host: string) => {
    const addrs = map[host];
    if (!addrs) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  });
}

describe('isPrivateOrReservedIp', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0',
    '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '198.18.0.1',
    '192.0.2.10',
  ])('blocks IPv4 %s', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', PUBLIC_V4, '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1'])(
    'allows public IPv4 %s',
    (ip) => {
      expect(isPrivateOrReservedIp(ip)).toBe(false);
    }
  );

  it.each([
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1',
    '[::1]', '[fd00::1]',
    // IPv4-mapped forms of private v4
    '::ffff:127.0.0.1', '::ffff:7f00:1', '[::ffff:169.254.169.254]', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1',
    // NAT64 / 6to4 embedding private v4
    '64:ff9b::7f00:1', '2002:7f00:1::',
    '2001:db8::1',
  ])('blocks IPv6 %s', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '[2606:4700::1]'])(
    'allows public IPv6 %s',
    (ip) => {
      expect(isPrivateOrReservedIp(ip)).toBe(false);
    }
  );

  it('fails closed on non-IP input', () => {
    expect(isPrivateOrReservedIp('example.com')).toBe(true);
    expect(isPrivateOrReservedIp('')).toBe(true);
  });
});

describe('checkUrlSyntax', () => {
  const blocked = (url: string) => {
    expect(() => checkUrlSyntax(url)).toThrow(SafeFetchError);
  };

  it('rejects non-http(s) schemes', () => {
    blocked('file:///etc/passwd');
    blocked('ftp://example.com/');
    blocked('gopher://example.com/');
  });

  it('rejects invalid URLs', () => {
    blocked('not a url');
  });

  it('rejects localhost names', () => {
    blocked('http://localhost/');
    blocked('http://LOCALHOST.:8080/');
    blocked('http://foo.localhost/');
  });

  it('rejects numeric-encoded IPv4 loopback/metadata literals', () => {
    blocked('http://2130706433/'); // decimal 127.0.0.1
    blocked('http://0177.0.0.1/'); // octal
    blocked('http://0x7f.0.0.1/'); // hex octet
    blocked('http://0x7f000001/'); // hex whole
    blocked('http://127.1/'); // short form
    blocked('http://0/'); // 0.0.0.0
    blocked('http://2852039166/'); // 169.254.169.254
  });

  it('rejects bracketed IPv6 literals in private ranges', () => {
    blocked('http://[::1]/');
    blocked('http://[::]/');
    blocked('http://[::ffff:127.0.0.1]/');
    blocked('http://[fd00::1]:8080/');
    blocked('http://[fe80::1]/');
  });

  it('accepts public hosts and literals', () => {
    expect(checkUrlSyntax('https://services.arcgis.com/x/FeatureServer').hostname).toBe('services.arcgis.com');
    expect(() => checkUrlSyntax('http://8.8.8.8/')).not.toThrow();
    expect(() => checkUrlSyntax('http://[2606:4700:4700::1111]/')).not.toThrow();
  });
});

describe('assertPublicUrl (DNS)', () => {
  beforeEach(() => mockLookup.mockReset());

  it('accepts hostnames resolving only to public addresses', async () => {
    hostResolvesTo({ 'good.example': [PUBLIC_V4, '2606:4700::1'] });
    await expect(assertPublicUrl('https://good.example/')).resolves.toBeInstanceOf(URL);
    expect(mockLookup).toHaveBeenCalledWith('good.example', expect.objectContaining({ all: true }));
  });

  it('rejects if ANY resolved address is private', async () => {
    hostResolvesTo({ 'mixed.example': [PUBLIC_V4, '10.0.0.5'] });
    await expect(assertPublicUrl('https://mixed.example/')).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('rejects hostnames resolving to mapped loopback', async () => {
    hostResolvesTo({ 'sneaky.example': ['::ffff:127.0.0.1'] });
    await expect(assertPublicUrl('https://sneaky.example/')).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('reports DNS failures', async () => {
    hostResolvesTo({});
    await expect(assertPublicUrl('https://nx.example/')).rejects.toMatchObject({ code: 'dns_failure' });
  });

  it('does not resolve IP literals', async () => {
    await assertPublicUrl('http://8.8.8.8/');
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe('safeFetch redirects', () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  const redirect = (location: string, status = 302) => ({
    status,
    ok: false,
    headers: new Headers({ location }),
    body: null,
  });
  const ok = (body = 'ok') => ({ status: 200, ok: true, headers: new Headers(), body: null, text: async () => body });

  beforeEach(() => {
    mockLookup.mockReset();
    hostResolvesTo({
      'a.example': [PUBLIC_V4],
      'b.example': [PUBLIC_V4],
      'evil.example': ['169.254.169.254'],
    });
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('uses manual redirect mode and a timeout signal', async () => {
    mockFetch.mockResolvedValueOnce(ok());
    await safeFetch('https://a.example/x');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://a.example/x',
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) })
    );
  });

  it('follows redirects to public hosts, re-validating each hop', async () => {
    mockFetch
      .mockResolvedValueOnce(redirect('https://b.example/next'))
      .mockResolvedValueOnce(redirect('/final', 301))
      .mockResolvedValueOnce(ok('done'));
    const res = await safeFetch('https://a.example/start');
    expect(await res.text()).toBe('done');
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      'https://a.example/start',
      'https://b.example/next',
      'https://b.example/final',
    ]);
    expect(mockLookup).toHaveBeenCalledWith('b.example', expect.anything());
  });

  it('refuses a redirect to a private IP literal', async () => {
    mockFetch.mockResolvedValueOnce(redirect('http://127.0.0.1:8080/admin'));
    await expect(safeFetch('https://a.example/')).rejects.toMatchObject({ code: 'blocked_address' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a host that resolves privately', async () => {
    mockFetch.mockResolvedValueOnce(redirect('http://evil.example/latest/meta-data/'));
    await expect(safeFetch('https://a.example/')).rejects.toMatchObject({ code: 'blocked_address' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to a non-http scheme', async () => {
    mockFetch.mockResolvedValueOnce(redirect('file:///etc/passwd'));
    await expect(safeFetch('https://a.example/')).rejects.toMatchObject({ code: 'blocked_protocol' });
  });

  it('gives up after too many redirects', async () => {
    mockFetch.mockResolvedValue(redirect('https://a.example/loop'));
    await expect(safeFetch('https://a.example/', { maxRedirects: 3 })).rejects.toMatchObject({
      code: 'too_many_redirects',
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('never calls fetch for a blocked initial URL', async () => {
    await expect(safeFetch('http://[::1]/')).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch('https://evil.example/')).rejects.toBeInstanceOf(SafeFetchError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
