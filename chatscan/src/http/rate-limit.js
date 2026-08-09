/**
 * Fixed-window rate limiter keyed by client address. Enough to stop a runaway
 * client from flooding the mempool; a public deployment should sit behind a real
 * gateway as well.
 */
export class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.limit requests allowed per window
   * @param {number} [options.windowMs]
   */
  constructor({ limit, windowMs = 60_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.buckets = new Map();
  }

  /**
   * @param {string} key
   * @param {number} [now]
   * @returns {{ allowed: boolean, remaining: number, retryAfterSeconds: number }}
   */
  consume(key, now = Date.now()) {
    if (this.limit <= 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 };

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (this.buckets.size > 10_000) this.#evict(now);

    const remaining = Math.max(0, this.limit - bucket.count);
    return {
      allowed: bucket.count <= this.limit,
      remaining,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  /** @param {number} now */
  #evict(now) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
