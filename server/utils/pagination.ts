import { z } from 'zod'

// ============================================================================
// Mitsubishi Dealer Portal — shared list pagination (opt-in, server-side)
// ----------------------------------------------------------------------------
// List endpoints (orders/dealers/parts) historically returned the FULL set.
// To bound those responses without breaking existing callers, pagination is
// OPT-IN: a request only paginates when it sends `?page=` and/or `?limit=`.
//   • no page/limit query     → readPagination() returns null → caller keeps
//                                its legacy `{ <key>: [...] }` shape.
//   • page and/or limit given  → caller slices with paginate() and returns the
//                                slice plus a `meta` block (total/totalPages/…).
//
// Params are coerced + clamped (never 400) so a stray ?page=abc or ?limit=9999
// degrades gracefully to sane bounds rather than erroring a page render.
// ============================================================================

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

export interface PaginationParams {
  page: number
  limit: number
}

export interface PageMeta {
  /** 1-based page number actually served. */
  page: number
  /** Page size actually applied (clamped to [1, MAX_LIMIT]). */
  limit: number
  /** Total number of items across all pages (the full, unsliced set). */
  total: number
  /** Number of pages at this limit (0 when there are no items). */
  totalPages: number
  /** True when more items exist after this page. */
  hasMore: boolean
}

// Coerce → integer → clamp. `.catch` swallows non-numeric / non-integer input
// (e.g. 'abc', 1.5, NaN) back to the default, then the transform clamps range.
const pageSchema = z.coerce
  .number()
  .int()
  .catch(1)
  .transform((n) => Math.max(n, 1))

const limitSchema = z.coerce
  .number()
  .int()
  .catch(DEFAULT_LIMIT)
  .transform((n) => Math.min(Math.max(n, 1), MAX_LIMIT))

/**
 * Read pagination params from the request query.
 * Returns `null` when neither `page` nor `limit` is present — the signal for
 * callers to preserve the legacy full-list response shape.
 */
export function readPagination(event: import('h3').H3Event): PaginationParams | null {
  const q = getQuery(event)
  if (q.page === undefined && q.limit === undefined) return null
  return {
    page: pageSchema.parse(q.page),
    limit: limitSchema.parse(q.limit),
  }
}

/**
 * Slice an in-memory, already-filtered/sorted array into one page and build the
 * accompanying meta. Pagination is applied AFTER any RBAC scoping and filtering
 * so `total` reflects the set the caller is actually allowed to see.
 */
export function paginate<T>(
  items: T[],
  { page, limit }: PaginationParams,
): { items: T[]; meta: PageMeta } {
  const total = items.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit)
  const start = (page - 1) * limit
  return {
    items: items.slice(start, start + limit),
    meta: { page, limit, total, totalPages, hasMore: start + limit < total },
  }
}
