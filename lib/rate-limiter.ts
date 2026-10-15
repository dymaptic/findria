interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/** Hard cap on tracked keys; protects memory if many IPs hit us inside one window. */
const DEFAULT_MAX_ENTRIES = 50_000;
/** Minimum spacing between opportunistic sweeps triggered from check(). */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Fixed-window in-memory rate limiter.
 *
 * Expired entries are evicted (a) by a background interval where timers are
 * available, (b) opportunistically from check() at most once per
 * SWEEP_INTERVAL_MS (covers runtimes where the interval never fires), and (c)
 * by a hard size cap that drops the oldest-inserted keys.
 */
export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastSweep = Date.now();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {
    // Cleanup expired entries every 60 seconds
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), SWEEP_INTERVAL_MS);
      // Don't prevent process from exiting
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  check(
    key: string,
    limit: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    if (now - this.lastSweep >= SWEEP_INTERVAL_MS) {
      this.cleanup(now);
    }

    const entry = this.store.get(key);

    // No existing entry or window expired - create new entry
    if (!entry || now >= entry.resetAt) {
      const resetAt = now + windowMs;
      // Delete first so re-insertion moves the key to the end (insertion order = age)
      this.store.delete(key);
      this.store.set(key, { count: 1, resetAt });
      this.enforceMaxSize(now);
      return { allowed: true, remaining: limit - 1, resetAt };
    }

    // Within window - increment count
    entry.count++;

    if (entry.count > limit) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
  }

  /** True if `key` has already reached `limit` in its current window. Does not count a hit. */
  isLimited(key: string, limit: number): boolean {
    const entry = this.store.get(key);
    if (!entry || Date.now() >= entry.resetAt) return false;
    return entry.count >= limit;
  }

  /** Number of tracked keys (for tests / diagnostics). */
  get size(): number {
    return this.store.size;
  }

  private enforceMaxSize(now: number): void {
    if (this.store.size <= this.maxEntries) return;
    this.cleanup(now);
    // Still over: drop oldest-inserted keys
    const it = this.store.keys();
    while (this.store.size > this.maxEntries) {
      const oldest = it.next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  private cleanup(now: number = Date.now()): void {
    this.lastSweep = now;
    this.store.forEach((entry, key) => {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    });
  }

  // For testing
  clear(): void {
    this.store.clear();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
