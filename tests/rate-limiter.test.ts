import { RateLimiter } from '@/lib/rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('basic functionality', () => {
    it('should allow requests within the limit', () => {
      const result = limiter.check('test-key', 5, 60000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should track remaining requests correctly', () => {
      limiter.check('test-key', 5, 60000);
      limiter.check('test-key', 5, 60000);
      const result = limiter.check('test-key', 5, 60000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('should block requests over the limit', () => {
      // Use up all requests
      for (let i = 0; i < 5; i++) {
        limiter.check('test-key', 5, 60000);
      }

      // Next request should be blocked
      const result = limiter.check('test-key', 5, 60000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should return resetAt timestamp', () => {
      const before = Date.now();
      const result = limiter.check('test-key', 5, 60000);
      const after = Date.now();

      expect(result.resetAt).toBeGreaterThanOrEqual(before + 60000);
      expect(result.resetAt).toBeLessThanOrEqual(after + 60000);
    });
  });

  describe('key isolation', () => {
    it('should track different keys independently', () => {
      // Exhaust key1
      for (let i = 0; i < 5; i++) {
        limiter.check('key1', 5, 60000);
      }

      // key2 should still be allowed
      const result = limiter.check('key2', 5, 60000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      // key1 should be blocked
      const key1Result = limiter.check('key1', 5, 60000);
      expect(key1Result.allowed).toBe(false);
    });
  });

  describe('window expiration', () => {
    it('should reset after window expires', async () => {
      // Use a short window for testing
      const windowMs = 100;

      // Use all requests
      for (let i = 0; i < 3; i++) {
        limiter.check('test-key', 3, windowMs);
      }

      // Should be blocked
      let result = limiter.check('test-key', 3, windowMs);
      expect(result.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, windowMs + 10));

      // Should be allowed again
      result = limiter.check('test-key', 3, windowMs);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });
  });

  describe('clear functionality', () => {
    it('should clear all entries', () => {
      // Add some entries
      limiter.check('key1', 5, 60000);
      limiter.check('key2', 5, 60000);

      // Clear
      limiter.clear();

      // Both should be fresh
      const result1 = limiter.check('key1', 5, 60000);
      const result2 = limiter.check('key2', 5, 60000);

      expect(result1.remaining).toBe(4);
      expect(result2.remaining).toBe(4);
    });
  });

  describe('edge cases', () => {
    it('should handle limit of 1', () => {
      const result1 = limiter.check('test-key', 1, 60000);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(0);

      const result2 = limiter.check('test-key', 1, 60000);
      expect(result2.allowed).toBe(false);
    });

    it('should handle very short windows', () => {
      const result = limiter.check('test-key', 100, 1);
      expect(result.allowed).toBe(true);
    });

    it('should handle concurrent checks for same key', () => {
      // Simulate concurrent requests
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(limiter.check('test-key', 5, 60000));
      }

      // First 5 should be allowed
      const allowed = results.filter((r) => r.allowed);
      const blocked = results.filter((r) => !r.allowed);

      expect(allowed.length).toBe(5);
      expect(blocked.length).toBe(5);
    });
  });
});

describe('Rate Limiting Integration Scenarios', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  afterEach(() => {
    limiter.destroy();
  });

  it('should simulate chat API rate limiting (20 requests/minute)', () => {
    const LIMIT = 20;
    const WINDOW = 60000;
    const clientIp = '192.168.1.100';
    const key = `chat:${clientIp}`;

    // First 20 requests should pass
    for (let i = 0; i < LIMIT; i++) {
      const result = limiter.check(key, LIMIT, WINDOW);
      expect(result.allowed).toBe(true);
    }

    // 21st request should fail
    const blocked = limiter.check(key, LIMIT, WINDOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('should allow different IPs independently', () => {
    const LIMIT = 5;
    const WINDOW = 60000;

    // Exhaust IP1
    for (let i = 0; i < LIMIT; i++) {
      limiter.check('chat:192.168.1.1', LIMIT, WINDOW);
    }

    // IP1 blocked
    expect(limiter.check('chat:192.168.1.1', LIMIT, WINDOW).allowed).toBe(false);

    // IP2 still allowed
    expect(limiter.check('chat:192.168.1.2', LIMIT, WINDOW).allowed).toBe(true);
  });

  it('should handle burst traffic followed by silence', async () => {
    const LIMIT = 5;
    const WINDOW = 100; // Short window for testing

    // Burst: use all requests
    for (let i = 0; i < LIMIT; i++) {
      limiter.check('burst-key', LIMIT, WINDOW);
    }

    // Should be blocked
    expect(limiter.check('burst-key', LIMIT, WINDOW).allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, WINDOW + 10));

    // Should be allowed again with full quota
    const result = limiter.check('burst-key', LIMIT, WINDOW);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(LIMIT - 1);
  });

  describe('eviction', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('sweeps expired entries opportunistically from check()', () => {
      jest.useFakeTimers({ now: 1_000_000 });
      const l = new RateLimiter();
      for (let i = 0; i < 100; i++) l.check(`k${i}`, 5, 1_000);
      expect(l.size).toBe(100);

      jest.setSystemTime(1_000_000 + 61_000);
      l.check('fresh', 5, 1_000);
      expect(l.size).toBe(1);
      l.destroy();
    });

    it('enforces a hard cap on tracked keys', () => {
      const l = new RateLimiter(10);
      for (let i = 0; i < 25; i++) l.check(`k${i}`, 5, 60_000);
      expect(l.size).toBe(10);
      // Oldest keys were dropped, newest kept
      expect(l.isLimited('k24', 1)).toBe(true);
      expect(l.isLimited('k0', 1)).toBe(false);
      l.destroy();
    });
  });

  describe('isLimited', () => {
    it('reports limit without counting a hit', () => {
      limiter.check('a', 2, 60_000);
      expect(limiter.isLimited('a', 2)).toBe(false);
      limiter.check('a', 2, 60_000);
      expect(limiter.isLimited('a', 2)).toBe(true);
      expect(limiter.isLimited('unknown', 2)).toBe(false);
    });
  });
});
