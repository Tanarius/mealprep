import crypto from 'crypto';

interface CacheEntry<T> {
  value: T;
  expiry: number;
}

const MAX_CACHE_ENTRIES = 500;

// LIMITATION: this cache is a process-local Map. It empties on every Railway
// restart/deploy, and it would NOT be shared across instances if the app ever runs
// more than one — so its cost savings are smaller than they look, and it silently
// stops deduplicating the moment there are two processes. Fine at current scale;
// migrate to Redis (or similar) before scaling horizontally.
class InMemCache {
  private store: Map<string, CacheEntry<any>> = new Map();

  generateKey(prefix: string, data: any): string {
    const str = JSON.stringify(data);
    const hash = crypto.createHash('sha256').update(str).digest('hex');
    return `${prefix}:${hash}`;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Evict oldest entry when at capacity
    if (this.store.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiry: Date.now() + ttlMs });
  }

  delete(key: string) {
    this.store.delete(key);
  }
  
  clear() {
    this.store.clear();
  }

  /** Evict all expired entries. Called periodically by background interval. */
  evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiry) this.store.delete(key);
    }
  }
}

export const aiCache = new InMemCache();
// 24 hours in MS
export const TTL_24H = 24 * 60 * 60 * 1000;

// Evict expired entries every 10 minutes to prevent unbounded growth
setInterval(() => aiCache.evictExpired(), 10 * 60 * 1000).unref();
