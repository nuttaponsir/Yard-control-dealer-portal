// Test1 (QA backend) — opt-in list pagination on GET /api/orders, /api/dealers,
// /api/parts. Verifies: (a) no ?page/?limit keeps the legacy full-list shape
// with NO meta; (b) page/limit slice correctly with a correct meta block;
// (c) limit clamps to MAX_LIMIT and bad/zero params fall back to sane defaults;
// (d) pagination composes with existing filters (dealers ?q=, parts ?category=).
//
// Assertions are count-AGNOSTIC: each test first reads the full (unpaginated)
// set as a baseline, so they hold regardless of how many rows other test files
// have created in the shared DB, and regardless of physical row order (we
// compare id SETS across pages, never positional slices).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { DEFAULT_LIMIT, MAX_LIMIT } from '../../server/utils/pagination'

interface PageMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasMore: boolean
}

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

// Walk every page at a given limit, returning the ordered list of id-arrays
// (one per page) plus the meta of the first page.
async function collectPages<T>(
  get: (qs: string) => Promise<{ body: { meta?: PageMeta } & Record<string, T[]> }>,
  key: string,
  idOf: (row: T) => string | number,
  limit: number,
): Promise<{ pages: (string | number)[][]; firstMeta: PageMeta }> {
  const first = await get(`?page=1&limit=${limit}`)
  const firstMeta = first.body.meta!
  const pages: (string | number)[][] = [first.body[key]!.map(idOf)]
  for (let p = 2; p <= firstMeta.totalPages; p++) {
    const r = await get(`?page=${p}&limit=${limit}`)
    pages.push(r.body[key]!.map(idOf))
  }
  return { pages, firstMeta }
}

describe('GET /api/orders pagination', () => {
  it('no params → full list, no meta', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ orders: unknown[]; meta?: PageMeta }>('/api/orders')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.orders)).toBe(true)
    expect(r.body.meta).toBeUndefined()
  })

  it('page/limit slice with correct meta; pages partition the full set', async () => {
    const admin = await loginAs('admin@demo.co')
    const baseline = await admin.get<{ orders: { poNumber: string }[] }>('/api/orders')
    const total = baseline.body.orders.length
    const baseIds = new Set(baseline.body.orders.map((o) => o.poNumber))

    const limit = 10
    const { pages, firstMeta } = await collectPages<{ poNumber: string }>(
      (qs) => admin.get('/api/orders' + qs),
      'orders',
      (o) => o.poNumber,
      limit,
    )

    expect(firstMeta.total).toBe(total)
    expect(firstMeta.limit).toBe(limit)
    expect(firstMeta.page).toBe(1)
    expect(firstMeta.totalPages).toBe(Math.ceil(total / limit))
    expect(firstMeta.hasMore).toBe(total > limit)

    // Every page except the last is full; the union of all pages == full set,
    // with no duplicates (slices partition the list).
    const flat = pages.flat()
    expect(new Set(flat).size).toBe(flat.length) // no overlap across pages
    expect(new Set(flat)).toEqual(baseIds) // covers everything
    for (let i = 0; i < pages.length - 1; i++) expect(pages[i]!.length).toBe(limit)
  })

  it('limit above MAX clamps; page past the end is empty but meta is correct', async () => {
    const admin = await loginAs('admin@demo.co')
    const total = (await admin.get<{ orders: unknown[] }>('/api/orders')).body.orders.length

    const big = await admin.get<{ orders: unknown[]; meta: PageMeta }>('/api/orders?limit=9999')
    expect(big.body.meta.limit).toBe(MAX_LIMIT)
    expect(big.body.meta.hasMore).toBe(total > MAX_LIMIT)

    const past = await admin.get<{ orders: unknown[]; meta: PageMeta }>('/api/orders?page=99999&limit=5')
    expect(past.body.orders.length).toBe(0)
    expect(past.body.meta.total).toBe(total)
    expect(past.body.meta.hasMore).toBe(false)
  })

  it('non-numeric / zero params fall back to defaults', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ meta: PageMeta }>('/api/orders?page=abc&limit=xyz')
    expect(r.body.meta.page).toBe(1)
    expect(r.body.meta.limit).toBe(DEFAULT_LIMIT)

    const z = await admin.get<{ meta: PageMeta }>('/api/orders?page=0&limit=0')
    expect(z.body.meta.page).toBe(1)
    expect(z.body.meta.limit).toBe(1)
  })
})

describe('GET /api/dealers pagination', () => {
  it('no params → full list + summary, no meta', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ dealers: unknown[]; summary: { total: number }; meta?: PageMeta }>(
      '/api/dealers',
    )
    expect(r.status).toBe(200)
    expect(r.body.meta).toBeUndefined()
    expect(r.body.summary.total).toBe(r.body.dealers.length)
  })

  it('paginates while summary stays network-wide', async () => {
    const admin = await loginAs('admin@demo.co')
    const baseline = await admin.get<{ dealers: unknown[]; summary: { total: number } }>('/api/dealers')
    const total = baseline.body.dealers.length
    const summaryTotal = baseline.body.summary.total

    const r = await admin.get<{ dealers: unknown[]; summary: { total: number }; meta: PageMeta }>(
      '/api/dealers?page=1&limit=25',
    )
    expect(r.body.dealers.length).toBe(Math.min(25, total))
    expect(r.body.meta.total).toBe(total)
    expect(r.body.meta.totalPages).toBe(Math.ceil(total / 25))
    // Summary is computed from the FULL set, not the current page.
    expect(r.body.summary.total).toBe(summaryTotal)
  })

  it('pagination composes with the ?q= filter (meta.total reflects the filtered set)', async () => {
    const admin = await loginAs('admin@demo.co')
    const filtered = await admin.get<{ dealers: { code: string }[] }>('/api/dealers?q=a')
    const filteredCount = filtered.body.dealers.length

    const r = await admin.get<{ dealers: { code: string }[]; meta: PageMeta }>('/api/dealers?q=a&limit=5')
    expect(r.body.meta.total).toBe(filteredCount)
    expect(r.body.dealers.length).toBe(Math.min(5, filteredCount))
  })

  it('requires admin (RBAC preserved under pagination)', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get('/api/dealers?page=1&limit=5')
    expect(r.status).toBe(403)
  })
})

describe('GET /api/parts pagination', () => {
  it('no params → full list, no meta', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get<{ parts: unknown[]; meta?: PageMeta }>('/api/parts')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.parts)).toBe(true)
    expect(r.body.meta).toBeUndefined()
  })

  it('page/limit slice with correct meta', async () => {
    const sales = await loginAs('sales@demo.co')
    const total = (await sales.get<{ parts: unknown[] }>('/api/parts')).body.parts.length

    const r = await sales.get<{ parts: unknown[]; meta: PageMeta }>('/api/parts?page=1&limit=5')
    expect(r.body.parts.length).toBe(Math.min(5, total))
    expect(r.body.meta.total).toBe(total)
    expect(r.body.meta.totalPages).toBe(Math.ceil(total / 5))
    expect(r.body.meta.hasMore).toBe(total > 5)
  })

  it('pagination composes with the ?category= filter', async () => {
    const sales = await loginAs('sales@demo.co')
    const cat = await sales.get<{ parts: { category: string }[] }>('/api/parts?category=เบรก')
    const catCount = cat.body.parts.length

    const r = await sales.get<{ parts: { category: string }[]; meta: PageMeta }>(
      '/api/parts?category=เบรก&limit=2',
    )
    expect(r.body.meta.total).toBe(catCount)
    expect(r.body.parts.every((p) => p.category === 'เบรก')).toBe(true)
    expect(r.body.parts.length).toBe(Math.min(2, catCount))
  })
})
