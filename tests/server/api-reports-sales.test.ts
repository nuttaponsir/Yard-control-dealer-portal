// Dev2 — Phase D Sales reports accuracy + RBAC tests.
// Each test recomputes the expected aggregate INDEPENDENTLY from the base
// tables (applying the same non-cancelled filter) and asserts the endpoint
// matches. No hardcoded magic numbers — everything is tied to the seed data.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db } from '../../server/db'

const LIVE = (s: string) => s !== 'cancelled'
const OPEN = new Set(['pending', 'confirming', 'packing'])

// Shared seed DB: another process can write to `orders` between our API call
// and the independent recompute, which would make the counts disagree by a few
// (a flaky off-by-one). Re-read `orders` on both sides of the API call and only
// trust the pair when the table didn't change in that window (retry otherwise).
// The returned `orders` snapshot is the one the recompute MUST be derived from;
// any order-items belonging to orders outside this snapshot are filtered out by
// the per-test `live` set, so the comparison stays internally consistent.
type OrderRow = Awaited<ReturnType<typeof db.query.orders.findMany>>[number]
async function readStable<T>(callApi: () => Promise<T>): Promise<{ api: T; orders: OrderRow[] }> {
  const sig = (os: OrderRow[]) =>
    os.map((o) => `${o.id}:${o.status}:${o.totalValue}`).sort().join('|')
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await db.query.orders.findMany()
    const api = await callApi()
    const after = await db.query.orders.findMany()
    if (sig(before) === sig(after)) return { api, orders: after }
  }
  throw new Error('orders table kept mutating during the report read (concurrent writer)')
}

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

describe('GET /api/reports/sales-by-dealer (R-S1)', () => {
  it('matches an independent per-dealer rollup of non-cancelled orders', async () => {
    const admin = await loginAs('admin@demo.co')
    const { api: r, orders } = await readStable(() =>
      admin.get<{ rows: Array<{ dealerId: number; code: string; orderCount: number; totalSales: number }> }>(
        '/api/reports/sales-by-dealer',
      ),
    )
    expect(r.status).toBe(200)

    const dealers = await db.query.dealers.findMany()
    const dealerById = new Map(dealers.map((d) => [d.id, d]))

    const agg = new Map<number, { orderCount: number; totalSales: number }>()
    for (const o of orders) {
      if (!LIVE(o.status)) continue
      const cur = agg.get(o.dealerId) ?? { orderCount: 0, totalSales: 0 }
      cur.orderCount += 1
      cur.totalSales += o.totalValue
      agg.set(o.dealerId, cur)
    }
    const expected = [...agg.entries()]
      .map(([dealerId, v]) => ({
        dealerId,
        code: dealerById.get(dealerId)!.code,
        orderCount: v.orderCount,
        totalSales: v.totalSales,
      }))
      .sort((a, b) => b.totalSales - a.totalSales || a.code.localeCompare(b.code))

    const got = r.body.rows.map((x) => ({
      dealerId: x.dealerId,
      code: x.code,
      orderCount: x.orderCount,
      totalSales: x.totalSales,
    }))
    expect(got).toEqual(expected)
    // every reported dealer has >= 1 non-cancelled order
    expect(got.every((x) => x.orderCount >= 1)).toBe(true)
  })
})

describe('GET /api/reports/sales-by-category (R-S2)', () => {
  it('matches an independent line-level rollup by parts.category', async () => {
    const admin = await loginAs('admin@demo.co')
    const { api: r, orders } = await readStable(() =>
      admin.get<{ rows: Array<{ category: string; qty: number; revenue: number }> }>(
        '/api/reports/sales-by-category',
      ),
    )
    expect(r.status).toBe(200)

    const items = await db.query.orderItems.findMany()
    const parts = await db.query.parts.findMany()
    const live = new Set(orders.filter((o) => LIVE(o.status)).map((o) => o.id))
    const catByPart = new Map(parts.map((p) => [p.id, p.category]))

    const agg = new Map<string, { qty: number; revenue: number }>()
    for (const it of items) {
      if (!live.has(it.orderId)) continue
      const cat = catByPart.get(it.partId)!
      const cur = agg.get(cat) ?? { qty: 0, revenue: 0 }
      cur.qty += it.qty
      cur.revenue += it.unitPrice * it.qty
      agg.set(cat, cur)
    }
    const expected = [...agg.entries()]
      .map(([category, v]) => ({ category, qty: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category))

    expect(r.body.rows).toEqual(expected)
  })
})

describe('GET /api/reports/sales-by-region (R-S3)', () => {
  it('matches an independent per-region rollup via province→region', async () => {
    const admin = await loginAs('admin@demo.co')
    const { api: r, orders } = await readStable(() =>
      admin.get<{ rows: Array<{ region: string; orderCount: number; totalSales: number }> }>(
        '/api/reports/sales-by-region',
      ),
    )
    expect(r.status).toBe(200)

    const dealers = await db.query.dealers.findMany()
    const provinces = await db.query.provinces.findMany()
    const regionByProvince = new Map(provinces.map((p) => [p.name, p.region]))
    const provinceByDealer = new Map(dealers.map((d) => [d.id, d.province]))

    const agg = new Map<string, { orderCount: number; totalSales: number }>()
    for (const o of orders) {
      if (!LIVE(o.status)) continue
      const prov = provinceByDealer.get(o.dealerId)
      const region = (prov != null ? regionByProvince.get(prov) : undefined) ?? 'ไม่ระบุ'
      const cur = agg.get(region) ?? { orderCount: 0, totalSales: 0 }
      cur.orderCount += 1
      cur.totalSales += o.totalValue
      agg.set(region, cur)
    }
    const expected = [...agg.entries()]
      .map(([region, v]) => ({ region, orderCount: v.orderCount, totalSales: v.totalSales }))
      .sort((a, b) => b.totalSales - a.totalSales || a.region.localeCompare(b.region))

    expect(r.body.rows).toEqual(expected)
  })
})

describe('GET /api/reports/open-orders-aging (R-S5)', () => {
  it('buckets + rows match an independent recompute of open orders', async () => {
    const admin = await loginAs('admin@demo.co')
    const { api: r, orders } = await readStable(() =>
      admin.get<{
        buckets: Array<{ bucket: string; count: number; value: number }>
        rows: Array<{ id: number; daysOpen: number }>
      }>('/api/reports/open-orders-aging'),
    )
    expect(r.status).toBe(200)

    const open = orders.filter((o) => OPEN.has(o.status))

    // row count + id set must match exactly
    expect(r.body.rows.length).toBe(open.length)
    expect(new Set(r.body.rows.map((x) => x.id))).toEqual(new Set(open.map((o) => o.id)))

    // rows are sorted by daysOpen desc
    const days = r.body.rows.map((x) => x.daysOpen)
    expect(days).toEqual([...days].sort((a, b) => b - a))

    // bucket totals reconcile with the row count + value of open orders
    const totalCount = r.body.buckets.reduce((s, b) => s + b.count, 0)
    const totalValue = r.body.buckets.reduce((s, b) => s + b.value, 0)
    expect(totalCount).toBe(open.length)
    expect(totalValue).toBe(open.reduce((s, o) => s + o.totalValue, 0))
    // canonical bucket order present
    expect(r.body.buckets.map((b) => b.bucket)).toEqual(['0-3', '4-7', '8-14', '15+'])
  })
})

describe('GET /api/reports/top-parts (R-S6)', () => {
  it('honors ?limit and ranks by qty / revenue from non-cancelled lines', async () => {
    const admin = await loginAs('admin@demo.co')
    const limit = 5
    const { api: r, orders } = await readStable(() =>
      admin.get<{
        topByQty: Array<{ partId: number; qty: number; sku: string }>
        topByRevenue: Array<{ partId: number; revenue: number; sku: string }>
      }>(`/api/reports/top-parts?limit=${limit}`),
    )
    expect(r.status).toBe(200)

    const items = await db.query.orderItems.findMany()
    const parts = await db.query.parts.findMany()
    const live = new Set(orders.filter((o) => LIVE(o.status)).map((o) => o.id))
    const partById = new Map(parts.map((p) => [p.id, p]))

    const agg = new Map<number, { qty: number; revenue: number }>()
    for (const it of items) {
      if (!live.has(it.orderId)) continue
      const cur = agg.get(it.partId) ?? { qty: 0, revenue: 0 }
      cur.qty += it.qty
      cur.revenue += it.unitPrice * it.qty
      agg.set(it.partId, cur)
    }
    const all = [...agg.entries()].map(([partId, v]) => ({
      partId,
      sku: partById.get(partId)!.sku,
      qty: v.qty,
      revenue: v.revenue,
    }))
    const expQty = [...all]
      .sort((a, b) => b.qty - a.qty || a.sku.localeCompare(b.sku))
      .slice(0, limit)
      .map((x) => ({ partId: x.partId, qty: x.qty }))
    const expRev = [...all]
      .sort((a, b) => b.revenue - a.revenue || a.sku.localeCompare(b.sku))
      .slice(0, limit)
      .map((x) => ({ partId: x.partId, revenue: x.revenue }))

    expect(r.body.topByQty.map((x) => ({ partId: x.partId, qty: x.qty }))).toEqual(expQty)
    expect(r.body.topByRevenue.map((x) => ({ partId: x.partId, revenue: x.revenue }))).toEqual(expRev)
    expect(r.body.topByQty.length).toBeLessThanOrEqual(limit)
  })
})

describe('RBAC — sales reports are admin-only', () => {
  it('rejects a non-admin (sales) with 403', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get('/api/reports/sales-by-dealer')
    expect(r.status).toBe(403)
  })
})
