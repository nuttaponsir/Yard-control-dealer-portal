// Phase D — Dev3 accuracy tests for the Inventory + Finance report endpoints.
// Each test hits the live handler over HTTP (admin session) and then recomputes
// the expected payload INDEPENDENTLY from the base tables via db.query, so the
// assertion fails if the handler's aggregation drifts from the raw data.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db } from '../../server/db'

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

// ---- helpers: independent recomputation from base tables -------------------
async function loadInventoryJoined() {
  const inv = await db.query.inventory.findMany()
  const parts = await db.query.parts.findMany()
  const partById = new Map(parts.map((p) => [p.id, p]))
  return inv.map((i) => ({
    sku: partById.get(i.partId)!.sku,
    name: partById.get(i.partId)!.name,
    warehouse: i.warehouse,
    qtyOnHand: i.qtyOnHand,
    reorderPoint: i.reorderPoint,
  }))
}

function utilPct(limit: number, used: number) {
  return limit > 0 ? Math.round((used / limit) * 100) : 0
}

describe('R-I1 GET /api/reports/stock-on-hand', () => {
  it('returns per part×warehouse rows + per-part totals matching base tables', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { sku: string; name: string; warehouse: string; qtyOnHand: number; reorderPoint: number }[]
      byPart: { sku: string; name: string; totalQtyOnHand: number }[]
    }>('/api/reports/stock-on-hand')
    expect(r.status).toBe(200)

    const joined = await loadInventoryJoined()
    const expectedRows = joined
      .map((j) => ({
        sku: j.sku,
        name: j.name,
        warehouse: j.warehouse,
        qtyOnHand: j.qtyOnHand,
        reorderPoint: j.reorderPoint,
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.warehouse.localeCompare(b.warehouse))
    expect(r.body.rows).toEqual(expectedRows)

    const map = new Map<string, { sku: string; name: string; totalQtyOnHand: number }>()
    for (const j of expectedRows) {
      const cur = map.get(j.sku)
      if (cur) cur.totalQtyOnHand += j.qtyOnHand
      else map.set(j.sku, { sku: j.sku, name: j.name, totalQtyOnHand: j.qtyOnHand })
    }
    const expectedByPart = [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku))
    expect(r.body.byPart).toEqual(expectedByPart)
  })
})

describe('R-I2 GET /api/reports/low-stock', () => {
  it('returns only below-reorder rows with deficit, sorted desc', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { sku: string; deficit: number; qtyOnHand: number; reorderPoint: number }[]
      count: number
    }>('/api/reports/low-stock')
    expect(r.status).toBe(200)

    const joined = await loadInventoryJoined()
    const expected = joined
      .filter((j) => j.qtyOnHand < j.reorderPoint)
      .map((j) => ({
        sku: j.sku,
        name: j.name,
        warehouse: j.warehouse,
        qtyOnHand: j.qtyOnHand,
        reorderPoint: j.reorderPoint,
        deficit: j.reorderPoint - j.qtyOnHand,
      }))
      .sort((a, b) => b.deficit - a.deficit || a.sku.localeCompare(b.sku) || a.warehouse.localeCompare(b.warehouse))

    expect(r.body.count).toBe(expected.length)
    expect(r.body.rows).toEqual(expected)
    for (const row of r.body.rows) expect(row.qtyOnHand).toBeLessThan(row.reorderPoint)
  })
})

describe('R-I4 GET /api/reports/inventory-valuation', () => {
  it('computes per-part value (sum qty × price) and grand total', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { partId: number; sku: string; totalQty: number; price: number; value: number }[]
      grandTotal: number
    }>('/api/reports/inventory-valuation')
    expect(r.status).toBe(200)

    const parts = await db.query.parts.findMany()
    const inv = await db.query.inventory.findMany()
    const qtyByPart = new Map<number, number>()
    for (const i of inv) qtyByPart.set(i.partId, (qtyByPart.get(i.partId) ?? 0) + i.qtyOnHand)

    const expected = parts
      .map((p) => {
        const totalQty = qtyByPart.get(p.id) ?? 0
        return { partId: p.id, sku: p.sku, name: p.name, totalQty, price: p.price, value: totalQty * p.price }
      })
      .sort((a, b) => b.value - a.value || a.sku.localeCompare(b.sku))
    const expectedGrand = expected.reduce((s, e) => s + e.value, 0)

    expect(r.body.rows).toEqual(expected)
    expect(r.body.grandTotal).toBe(expectedGrand)
  })
})

describe('R-F1 GET /api/reports/credit-utilization', () => {
  it('computes per-dealer utilization + totals', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { dealerId: number; code: string; utilizationPct: number }[]
      totals: { sumLimit: number; sumUsed: number; avgUtilizationPct: number }
    }>('/api/reports/credit-utilization')
    expect(r.status).toBe(200)

    const dealers = await db.query.dealers.findMany()
    const expectedRows = dealers
      .map((d) => ({
        dealerId: d.id,
        code: d.code,
        name: d.name,
        grade: d.grade,
        creditLimit: d.creditLimit,
        creditUsed: d.creditUsed,
        utilizationPct: utilPct(d.creditLimit, d.creditUsed),
      }))
      .sort((a, b) => b.utilizationPct - a.utilizationPct || a.code.localeCompare(b.code))
    const sumLimit = expectedRows.reduce((s, e) => s + e.creditLimit, 0)
    const sumUsed = expectedRows.reduce((s, e) => s + e.creditUsed, 0)
    const avgUtilizationPct = expectedRows.length
      ? Math.round(expectedRows.reduce((s, e) => s + e.utilizationPct, 0) / expectedRows.length)
      : 0

    expect(r.body.rows).toEqual(expectedRows)
    expect(r.body.totals).toEqual({ sumLimit, sumUsed, avgUtilizationPct })
  })
})

describe('R-F2 GET /api/reports/credit-risk', () => {
  it('returns dealers above threshold (default 80) sorted desc', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      threshold: number
      count: number
      rows: { dealerId: number; code: string; utilizationPct: number }[]
    }>('/api/reports/credit-risk')
    expect(r.status).toBe(200)
    expect(r.body.threshold).toBe(80)

    const dealers = await db.query.dealers.findMany()
    const expected = dealers
      .map((d) => ({ dealerId: d.id, code: d.code, utilizationPct: utilPct(d.creditLimit, d.creditUsed) }))
      .filter((d) => d.utilizationPct > 80)
      .sort((a, b) => b.utilizationPct - a.utilizationPct || a.code.localeCompare(b.code))
    expect(r.body.count).toBe(expected.length)
    expect(r.body.rows.map((x) => x.dealerId)).toEqual(expected.map((x) => x.dealerId))
  })

  it('honors ?threshold=50 — every returned row > 50 and the set matches recompute', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      threshold: number
      count: number
      rows: { dealerId: number; utilizationPct: number }[]
    }>('/api/reports/credit-risk?threshold=50')
    expect(r.status).toBe(200)
    expect(r.body.threshold).toBe(50)

    for (const row of r.body.rows) expect(row.utilizationPct).toBeGreaterThan(50)

    const dealers = await db.query.dealers.findMany()
    const expectedIds = dealers
      .map((d) => ({ id: d.id, code: d.code, pct: utilPct(d.creditLimit, d.creditUsed) }))
      .filter((d) => d.pct > 50)
      .sort((a, b) => b.pct - a.pct || a.code.localeCompare(b.code))
      .map((d) => d.id)
    expect(r.body.rows.map((x) => x.dealerId)).toEqual(expectedIds)
    expect(r.body.count).toBe(expectedIds.length)
  })
})

describe('RBAC — reports are admin-only', () => {
  it('rejects a sales user with 403', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get('/api/reports/inventory-valuation')
    expect(r.status).toBe(403)
  })
})
