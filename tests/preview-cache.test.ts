/**
 * Tests for the bounded LRU + TTL cache used by PreviewService.
 */
jest.mock('@/services/arcgis.service', () => ({ arcgisService: {} }));
jest.mock('@/services/geoparquet.service', () => ({ geoParquetService: {} }));
jest.mock('@/lib/db', () => ({ queryOne: jest.fn() }));

import { LruTtlCache, PREVIEW_CACHE_MAX_ENTRIES } from '@/services/preview.service';

describe('LruTtlCache', () => {
  afterEach(() => jest.useRealTimers());

  it('evicts the least-recently-used entry when full', () => {
    const cache = new LruTtlCache<number>(3, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1); // a is now most recent
    cache.set('d', 4); // evicts b
    expect(cache.size).toBe(3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('never grows beyond maxEntries', () => {
    const cache = new LruTtlCache<number>(PREVIEW_CACHE_MAX_ENTRIES, 60_000);
    for (let i = 0; i < PREVIEW_CACHE_MAX_ENTRIES * 3; i++) cache.set(`k${i}`, i);
    expect(cache.size).toBe(PREVIEW_CACHE_MAX_ENTRIES);
    expect(cache.get('k0')).toBeUndefined();
    expect(cache.get(`k${PREVIEW_CACHE_MAX_ENTRIES * 3 - 1}`)).toBe(PREVIEW_CACHE_MAX_ENTRIES * 3 - 1);
  });

  it('expires entries on access after the TTL', () => {
    jest.useFakeTimers({ now: 0 });
    const cache = new LruTtlCache<string>(10, 1_000);
    cache.set('x', 'v');
    jest.setSystemTime(999);
    expect(cache.get('x')).toBe('v');
    jest.setSystemTime(2_500);
    expect(cache.get('x')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('drops expired entries before evicting live ones on insert', () => {
    jest.useFakeTimers({ now: 0 });
    const cache = new LruTtlCache<string>(2, 1_000);
    cache.set('old', 'o');
    jest.setSystemTime(500);
    cache.set('live', 'l');
    jest.setSystemTime(1_200); // 'old' expired, 'live' still valid
    cache.set('new', 'n');
    expect(cache.get('live')).toBe('l');
    expect(cache.get('new')).toBe('n');
    expect(cache.size).toBe(2);
  });

  it('evictExpired() removes only stale entries', () => {
    jest.useFakeTimers({ now: 0 });
    const cache = new LruTtlCache<number>(10, 1_000);
    cache.set('a', 1);
    jest.setSystemTime(600);
    cache.set('b', 2);
    jest.setSystemTime(1_100);
    cache.evictExpired();
    expect(cache.size).toBe(1);
    expect(cache.get('b')).toBe(2);
  });
});
