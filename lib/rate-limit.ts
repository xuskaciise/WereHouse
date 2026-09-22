// Small in-memory rate limiters. State is per server process, which is enough
// for the single-container deployment; use a shared store (e.g. Redis) if the
// app is ever scaled to multiple instances.

const MAX_KEYS = 5000

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return headers.get("x-real-ip")?.trim() || "unknown"
}

/** Allows at most `limit` hits per key within a sliding `windowMs`. */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  /** Records a hit and returns true if the key is now over the limit. */
  hit(key: string): boolean {
    const now = Date.now()
    const windowStart = now - this.windowMs
    const stamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart)
    stamps.push(now)
    this.hits.set(key, stamps)

    if (this.hits.size > MAX_KEYS) {
      for (const [k, arr] of this.hits) {
        const recent = arr.filter((t) => t > windowStart)
        if (recent.length === 0) this.hits.delete(k)
        else this.hits.set(k, recent)
      }
    }

    return stamps.length > this.limit
  }
}

/**
 * Locks a key (e.g. ip + username) for `lockMs` after `maxFailures` failed
 * attempts within `windowMs`. A successful attempt resets the counter.
 */
export class FailureLimiter {
  private failures = new Map<string, { count: number; firstAt: number; lockedUntil: number }>()

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly lockMs: number
  ) {}

  isBlocked(key: string): boolean {
    const entry = this.failures.get(key)
    if (!entry) return false
    const now = Date.now()
    if (entry.lockedUntil > now) return true
    if (now - entry.firstAt > this.windowMs) this.failures.delete(key)
    return false
  }

  recordFailure(key: string): void {
    const now = Date.now()
    let entry = this.failures.get(key)
    if (!entry || now - entry.firstAt > this.windowMs) {
      entry = { count: 0, firstAt: now, lockedUntil: 0 }
    }
    entry.count += 1
    if (entry.count >= this.maxFailures) entry.lockedUntil = now + this.lockMs
    this.failures.set(key, entry)

    if (this.failures.size > MAX_KEYS) {
      for (const [k, e] of this.failures) {
        if (e.lockedUntil <= now && now - e.firstAt > this.windowMs) this.failures.delete(k)
      }
    }
  }

  reset(key: string): void {
    this.failures.delete(key)
  }
}
