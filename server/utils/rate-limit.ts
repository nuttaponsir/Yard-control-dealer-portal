// ============================================================================
// Mitsubishi Dealer Portal — in-memory rate limiter (Phase F hardening)
// ----------------------------------------------------------------------------
// A tiny fixed-window counter used to throttle brute-force login attempts. It
// counts FAILED attempts only (callers reset on success), keyed by IP+email, so
// a legitimate user typing one wrong password is never penalised — only
// repeated failures trip the limit. Single-process/in-memory by design; a
// multi-instance deployment would swap this for Redis (the call sites stay the
// same).
// ============================================================================

interface Bucket {
  count: number
  resetAt: number // epoch ms when the window rolls over
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  blocked: boolean
  /** Seconds until the window resets (for the Retry-After header). */
  retryAfter: number
}

/**
 * Read-only: is `key` already over `limit` within its current window?
 * Does NOT mutate state, so call it before doing expensive work (e.g. bcrypt).
 */
export function checkRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) return { blocked: false, retryAfter: 0 }
  return {
    blocked: b.count >= limit,
    retryAfter: Math.ceil((b.resetAt - now) / 1000),
  }
}

/** Record one failure for `key`, starting/extending its window as needed. */
export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
  } else {
    b.count += 1
  }
}

/** Clear a key after a successful auth so the user starts fresh. */
export function clearRateLimit(key: string): void {
  buckets.delete(key)
}

/** Test-only: wipe all buckets. */
export function __resetRateLimits(): void {
  buckets.clear()
}
