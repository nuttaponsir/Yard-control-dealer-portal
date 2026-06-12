// Phase A regression tests — locks in the gaps closed in Phase A:
//   1. Catalog model-filtering (M1/M2): /api/parts?vin= / ?model= returns only
//      parts compatible with the vehicle's model (+ universal parts).
//   2. Claims RBAC: the `sales` role is blocked server-side from BOTH the claims
//      POST and GET endpoints (not just hidden in the nav).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'

const TRITON_VIN = 'MMTJNKB40NH000001' // seeded, autologicInstalled=true, model "Triton"
const PHEV_VIN = 'MMOJNPHEV2RH000006' // seeded, model "Outlander PHEV"

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

interface CatalogResp {
  parts: { sku: string; compatibleModels: string[] }[]
}

describe('Catalog model-filtering (M1/M2)', () => {
  it('?vin= returns only parts compatible with the VIN model (+ universal)', async () => {
    const sales = await loginAs('sales@demo.co')
    const all = await sales.get<CatalogResp>('/api/parts')
    const triton = await sales.get<CatalogResp>(`/api/parts?vin=${TRITON_VIN}`)

    expect(all.status).toBe(200)
    expect(triton.status).toBe(200)
    // Filtering must drop at least one incompatible part.
    expect(triton.body.parts.length).toBeGreaterThan(0)
    expect(triton.body.parts.length).toBeLessThan(all.body.parts.length)
    // Every returned part is universal (empty) OR explicitly fits "Triton".
    for (const p of triton.body.parts) {
      const ok = p.compatibleModels.length === 0 || p.compatibleModels.includes('Triton')
      expect(ok).toBe(true)
    }
  })

  it('?model= filters the same way as ?vin=', async () => {
    const sales = await loginAs('sales@demo.co')
    const byVin = await sales.get<CatalogResp>(`/api/parts?vin=${TRITON_VIN}`)
    const byModel = await sales.get<CatalogResp>('/api/parts?model=Triton')
    const a = byVin.body.parts.map((p) => p.sku).sort()
    const b = byModel.body.parts.map((p) => p.sku).sort()
    expect(b).toEqual(a)
  })

  it('different models yield different compatible sets', async () => {
    const sales = await loginAs('sales@demo.co')
    const triton = await sales.get<CatalogResp>(`/api/parts?vin=${TRITON_VIN}`)
    const phev = await sales.get<CatalogResp>(`/api/parts?vin=${PHEV_VIN}`)
    const tSkus = triton.body.parts.map((p) => p.sku).sort().join(',')
    const pSkus = phev.body.parts.map((p) => p.sku).sort().join(',')
    expect(tSkus).not.toEqual(pSkus)
  })

  it('no vin/model param returns the full catalog (back-compat)', async () => {
    const sales = await loginAs('sales@demo.co')
    const all = await sales.get<CatalogResp>('/api/parts')
    expect(all.body.parts.length).toBeGreaterThanOrEqual(8)
  })
})

describe('Claims RBAC — sales is blocked server-side', () => {
  it('sales CANNOT POST /api/claims (403)', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.post('/api/claims', {
      vin: TRITON_VIN,
      partSku: 'MIT-BP-003',
      reason: 'should be blocked',
    })
    expect(r.status).toBe(403)
  })

  it('sales CANNOT GET /api/claims (403)', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get('/api/claims')
    expect(r.status).toBe(403)
  })

  it('warehouse and owner CAN read claims (allowed roles)', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const owner = await loginAs('owner@demo.co')
    expect((await wh.get('/api/claims')).status).toBe(200)
    expect((await owner.get('/api/claims')).status).toBe(200)
  })
})
