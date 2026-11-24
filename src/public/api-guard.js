/**
 * Shared API Rate-Limit Guard, TTL Cache, In-Flight Request Coalescer,
 * and Browser Cache API helper (zero dependencies, works in Browser & Node.js).
 *
 * Designed to prevent HTTP 429 rate-limit exhaustion under high concurrency:
 *  - Token-bucket pacer smooths request bursts below upstream limits
 *  - Adaptive 429/503 circuit breaker respects Retry-After + exponential backoff
 *  - In-flight request coalescing deduplicates identical concurrent requests
 *  - Bounded LRU TTL cache avoids redundant upstream calls across users/views
 */

export class RateLimitCooldownError extends Error {
  constructor(remainingMs, status = 429) {
    super(`API rate limit cooldown (${Math.ceil(remainingMs / 1000)}s remaining)`);
    this.name = 'RateLimitCooldownError';
    this.status = status;
    this.remainingMs = remainingMs;
  }
}

export function parseRetryAfterMs(headerValue, now = Date.now()) {
  if (!headerValue) return null;
  const trimmed = String(headerValue).trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const secs = Number(trimmed);
    return Number.isFinite(secs) && secs >= 0 ? Math.round(secs * 1000) : null;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - now);
  }
  return null;
}

export class ApiRateGuard {
  constructor(options = {}) {
    this.maxBurst = Math.max(1, Number(options.maxBurst ?? 12));
    this.refillPerSec = Math.max(0.2, Number(options.refillPerSec ?? 4));
    this.maxCacheEntries = Math.max(50, Number(options.maxCacheEntries ?? 2500));
    this.baseBackoffMs = Math.max(500, Number(options.baseBackoffMs ?? 3000));
    this.maxBackoffMs = Math.max(this.baseBackoffMs, Number(options.maxBackoffMs ?? 60000));
    this.onCooldown = typeof options.onCooldown === 'function' ? options.onCooldown : null;

    this._tokens = this.maxBurst;
    this._lastRefillAt = Date.now();
    this._tokenQueue = Promise.resolve();

    this._cooldownUntil = 0;
    this._consecutive429 = 0;

    this._cache = new Map(); // key -> { value, ts }
    this._inflight = new Map(); // key -> Promise

    this._stats = {
      upstreamRequests: 0,
      cacheHits: 0,
      coalescedHits: 0,
      rateLimitedCount: 0,
      skippedDuringCooldown: 0,
    };
  }

  getCooldownRemainingMs(now = Date.now()) {
    return Math.max(0, this._cooldownUntil - now);
  }

  isCoolingDown(now = Date.now()) {
    return this._cooldownUntil > now;
  }

  getCached(key, ttlMs, now = Date.now()) {
    if (!ttlMs || ttlMs <= 0) return undefined;
    const entry = this._cache.get(key);
    if (!entry) return undefined;
    if (now - entry.ts > ttlMs) {
      this._cache.delete(key);
      return undefined;
    }
    // Refresh LRU position
    this._cache.delete(key);
    this._cache.set(key, entry);
    this._stats.cacheHits++;
    return entry.value;
  }

  setCached(key, value, now = Date.now()) {
    if (this._cache.has(key)) this._cache.delete(key);
    this._cache.set(key, { value, ts: now });
    if (this._cache.size > this.maxCacheEntries) {
      const oldest = this._cache.keys().next().value;
      if (oldest !== undefined) this._cache.delete(oldest);
    }
  }

  noteSuccess() {
    this._consecutive429 = 0;
  }

  noteRateLimited(status = 429, retryAfterHeader = null, now = Date.now()) {
    this._stats.rateLimitedCount++;
    this._consecutive429 = Math.min(8, this._consecutive429 + 1);
    const parsed = parseRetryAfterMs(retryAfterHeader, now);
    const exp = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * Math.pow(2, this._consecutive429 - 1)
    );
    const jitter = Math.round(Math.random() * 800);
    const waitMs = Math.min(this.maxBackoffMs, Math.max(parsed ?? 0, exp) + jitter);
    const until = now + waitMs;
    if (until > this._cooldownUntil) {
      this._cooldownUntil = until;
      if (this.onCooldown) {
        try {
          this.onCooldown(until, status, waitMs);
        } catch {
          // ignore callback errors
        }
      }
    }
    return waitMs;
  }

  async acquireToken({ skipDuringCooldown = true } = {}) {
    const rem = this.getCooldownRemainingMs();
    if (rem > 0) {
      if (skipDuringCooldown) {
        this._stats.skippedDuringCooldown++;
        throw new RateLimitCooldownError(rem);
      }
      await new Promise((r) => setTimeout(r, rem));
    }

    // Serialize token checkout to avoid thundering-herd races
    const wait = this._tokenQueue.then(async () => {
      const now = Date.now();
      const cooldownRem = this.getCooldownRemainingMs(now);
      if (cooldownRem > 0) {
        if (skipDuringCooldown) {
          this._stats.skippedDuringCooldown++;
          throw new RateLimitCooldownError(cooldownRem);
        }
        await new Promise((r) => setTimeout(r, cooldownRem));
      }

      const elapsedSec = Math.max(0, (Date.now() - this._lastRefillAt) / 1000);
      this._tokens = Math.min(this.maxBurst, this._tokens + elapsedSec * this.refillPerSec);
      this._lastRefillAt = Date.now();

      if (this._tokens < 1) {
        const waitMs = Math.ceil(((1 - this._tokens) / this.refillPerSec) * 1000);
        await new Promise((r) => setTimeout(r, waitMs));
        this._tokens = 0;
        this._lastRefillAt = Date.now();
      } else {
        this._tokens -= 1;
      }
    });

    this._tokenQueue = wait.catch(() => {});
    return wait;
  }

  /**
   * Executes an upstream operation protected by TTL cache, in-flight coalescing,
   * 429/503 circuit-breaker cooldown, and token-bucket pacing.
   */
  async run(key, options, fetcher) {
    const ttlMs = options?.ttlMs ?? 0;
    const skipDuringCooldown = options?.skipDuringCooldown ?? true;
    const cacheNullish = options?.cacheNullish ?? false;

    const cached = this.getCached(key, ttlMs);
    if (cached !== undefined) return cached;

    if (this._inflight.has(key)) {
      this._stats.coalescedHits++;
      return this._inflight.get(key);
    }

    const promise = (async () => {
      await this.acquireToken({ skipDuringCooldown });
      this._stats.upstreamRequests++;
      const result = await fetcher();
      this.noteSuccess();
      if (ttlMs > 0 && (cacheNullish || (result !== undefined && result !== null))) {
        this.setCached(key, result);
      }
      return result;
    })();

    this._inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this._inflight.get(key) === promise) {
        this._inflight.delete(key);
      }
    }
  }

  getStats() {
    return {
      ...this._stats,
      cacheSize: this._cache.size,
      inflightSize: this._inflight.size,
      cooldownRemainingMs: this.getCooldownRemainingMs(),
    };
  }
}

/**
 * Inspects a Fetch Response for 429/503 throttling and notifies the guard.
 * Returns true if the response was throttled.
 */
export function checkThrottledResponse(guard, res) {
  if (!res) return false;
  if (res.status === 429 || res.status === 503) {
    const retryAfter = res.headers?.get?.('retry-after') ?? null;
    const waitMs = guard.noteRateLimited(res.status, retryAfter);
    throw new RateLimitCooldownError(waitMs, res.status);
  }
  return false;
}

/**
 * Short-TTL Browser Cache API wrapper so page reloads & repeat visits reuse recent
 * live AIS tile/hub responses with zero external API calls (Browser-only, safe no-op in Node).
 */
export async function readBrowserCache(cacheName, url, ttlMs) {
  if (typeof caches === 'undefined' || !ttlMs) return null;
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (!hit) return null;
    const ts = Number(hit.headers.get('x-mg-cached-at') || 0);
    if (!ts || Date.now() - ts > ttlMs) {
      cache.delete(url).catch(() => {});
      return null;
    }
    return hit;
  } catch {
    return null;
  }
}

export async function writeBrowserCache(cacheName, url, body, contentType) {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(cacheName);
    const headers = new Headers({
      'Content-Type': contentType || 'application/octet-stream',
      'x-mg-cached-at': String(Date.now()),
    });
    await cache.put(url, new Response(body, { status: 200, headers }));
  } catch {
    // ignore quota or private-mode Cache API errors
  }
}
