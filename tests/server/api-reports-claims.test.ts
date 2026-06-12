// Phase D — Dev4 accuracy tests for the Claims + Executive report endpoints.
//   1. /api/reports/claims-by-status   (R-C1)
//   2. /api/reports/claim-rate-by-part (R-C2)
//   3. /api/reports/claims-by-model    (defect rate by model)
//   4. /api/reports/dealer-mix-by-grade(R-N1)
//   5. /api/reports/autologic-install  (R-N3)
// Each endpoint test re-derives its expected shape INDEPENDENTLY from the base
// tables via db.query, then asserts the live API matches. One RBAC test proves
// a non-admin (sales) is rejected with 403.
//
// NOTE: these routes must be mounted on the shared test harness server. Until
// they are wired into tests/server/harness.ts, the GET calls will 404 — that
// integration step is owned by the harness author.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db } from '../../server/db'

const STATUS_ORDER = ['submitted', 'reviewing', 'rejected', 'approved'] as const
const GRADE_ORDER = ['A', 'B', 'C'] as const

beforeAll(async () => {
  await startServer()
})

afterAll(async () => {
  await stopServer()
})

describe('GET /api/reports/claims-by-status (R-C1)', () => {
  it('returns zero-filled counts + totalAmount per status in fixed order', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { status: string; count: number; totalAmount: number }[]
      totalClaims: number
    }>('/api/reports/claims-by-status')
    expect(r.status).toBe(200)

    const claims = await db.query.claims.findMany()
    const expected = STATUS_ORDER.map((status) => {
      const mine = claims.filter((c) => c.status === status)
      return {
        status,
        count: mine.length,
        totalAmount: mine.reduce((s, c) => s + c.amount, 0),
      }
    })

    expect(r.body.rows).toEqual(expected)
    expect(r.body.totalClaims).toBe(claims.length)
  })
})

describe('GET /api/reports/claim-rate-by-part (R-C2)', () => {
  it('computes claimCount, qtySold (non-cancelled) and ratePct per claimed sku', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { sku: string; name: string; claimCount: number; qtySold: number; ratePct: number | null }[]
    }>('/api/reports/claim-rate-by-part')
    expect(r.status).toBe(200)

    const claims = await db.query.claims.findMany()
    const parts = await db.query.parts.findMany()
    const orders = await db.query.orders.findMany()
    const items = await db.query.orderItems.findMany()

    const partBySku = new Map(parts.map((p) => [p.sku, p]))
    const liveOrderIds = new Set(orders.filter((o) => o.status !== 'cancelled').map((o) => o.id))

    const qtySoldByPartId = new Map<number, number>()
    for (const it of items) {
      if (!liveOrderIds.has(it.orderId)) continue
      qtySoldByPartId.set(it.partId, (qtySoldByPartId.get(it.partId) ?? 0) + it.qty)
    }

    const claimCountBySku = new Map<string, number>()
    for (const c of claims) claimCountBySku.set(c.partSku, (claimCountBySku.get(c.partSku) ?? 0) + 1)

    const expected = [...claimCountBySku.entries()].map(([sku, claimCount]) => {
      const part = partBySku.get(sku)
      const qtySold = part ? qtySoldByPartId.get(part.id) ?? 0 : 0
      const ratePct = qtySold > 0 ? Math.round((claimCount / qtySold) * 10000) / 100 : null
      return { sku, name: part?.name ?? sku, claimCount, qtySold, ratePct }
    })
    expected.sort((a, b) => b.claimCount - a.claimCount || a.sku.localeCompare(b.sku))

    expect(r.body.rows).toEqual(expected)
  })
})

describe('GET /api/reports/claims-by-model (defect rate by model)', () => {
  it('counts claims per resolved vins.model, sorted by claimCount desc', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { model: string; claimCount: number }[]
      totalClaims: number
    }>('/api/reports/claims-by-model')
    expect(r.status).toBe(200)

    const claims = await db.query.claims.findMany()
    const vins = await db.query.vins.findMany()
    const modelByVin = new Map(vins.map((v) => [v.vin, v.model]))

    const agg = new Map<string, number>()
    let totalClaims = 0
    for (const c of claims) {
      const model = modelByVin.get(c.vin)
      if (model == null) continue
      agg.set(model, (agg.get(model) ?? 0) + 1)
      totalClaims += 1
    }
    const expected = [...agg.entries()].map(([model, claimCount]) => ({ model, claimCount }))
    expected.sort((a, b) => b.claimCount - a.claimCount || a.model.localeCompare(b.model))

    expect(r.body.rows).toEqual(expected)
    expect(r.body.totalClaims).toBe(totalClaims)
  })
})

describe('GET /api/reports/dealer-mix-by-grade (R-N1)', () => {
  it('rolls up dealer count, credit limit, and non-cancelled sales per grade', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      rows: { grade: string; dealerCount: number; sumCreditLimit: number; totalSales: number }[]
    }>('/api/reports/dealer-mix-by-grade')
    expect(r.status).toBe(200)

    const dealers = await db.query.dealers.findMany()
    const orders = await db.query.orders.findMany()
    const gradeByDealerId = new Map(dealers.map((d) => [d.id, d.grade]))

    const expected = GRADE_ORDER.map((grade) => {
      const mine = dealers.filter((d) => d.grade === grade)
      const totalSales = orders
        .filter((o) => o.status !== 'cancelled' && gradeByDealerId.get(o.dealerId) === grade)
        .reduce((s, o) => s + o.totalValue, 0)
      return {
        grade,
        dealerCount: mine.length,
        sumCreditLimit: mine.reduce((s, d) => s + d.creditLimit, 0),
        totalSales,
      }
    })

    expect(r.body.rows).toEqual(expected)
  })
})

describe('GET /api/reports/autologic-install (R-N3)', () => {
  it('summarizes install penetration and lists un-installed VINs', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{
      summary: { total: number; installed: number; notInstalled: number; installRatePct: number }
      opportunities: { vin: string; model: string; status: string }[]
    }>('/api/reports/autologic-install')
    expect(r.status).toBe(200)

    const vins = await db.query.vins.findMany()
    const total = vins.length
    const installed = vins.filter((v) => v.autologicInstalled).length
    const notInstalled = total - installed
    const installRatePct = total > 0 ? Math.round((installed / total) * 100) : 0

    expect(r.body.summary).toEqual({ total, installed, notInstalled, installRatePct })

    const expectedOpps = vins
      .filter((v) => !v.autologicInstalled)
      .map((v) => ({ vin: v.vin, model: v.model, status: v.status }))
    expectedOpps.sort((a, b) => a.vin.localeCompare(b.vin))

    expect(r.body.opportunities).toEqual(expectedOpps)
  })
})

describe('RBAC — non-admin is forbidden', () => {
  it('rejects a sales user with 403', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get('/api/reports/claims-by-status')
    expect(r.status).toBe(403)
  })
})
