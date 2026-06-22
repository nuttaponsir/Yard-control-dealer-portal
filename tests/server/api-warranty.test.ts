// Phase 5 — Warranty registrations (per VIN + part).
// ----------------------------------------------------------------------------
// owner/sales register for their own dealer (dealerId forced from the session,
// body ignored); admin may void (admin-only). expiresAt = startDate + months.
// GET is dealer-scoped for owner/sales. The suite tracks every warranty id it
// creates and deletes them in afterAll, leaving the 2 seed warranties
// (WAR-2026-000001/000002) intact. No inventory/credit is touched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const INSTALLED_VIN = 'MMTJNKB40NH000001'
const PART_SKU = 'MIT-OF-001'

interface Warranty {
  id: number
  warrantyNo: string
  vin: string
  dealerId: number | null
  expiresAt: string
  status: string
}

let admin: Client
let owner: Client // DLR0001
let ownerDealerId = 0

const createdWarrantyIds: number[] = []

beforeAll(async () => {
  await startServer()
  admin = await loginAs('admin@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001

  const dealers = await admin.get<{ dealers: { id: number; code: string }[] }>('/api/dealers')
  ownerDealerId = dealers.body.dealers.find((d) => d.code === 'DLR0001')!.id
})

afterAll(async () => {
  if (createdWarrantyIds.length) {
    await db.delete(schema.warranties).where(inArray(schema.warranties.id, createdWarrantyIds))
  }
  await stopServer()
})

describe('POST /api/warranty (register)', () => {
  it('owner registers → dealerId forced to own dealer; expiresAt = start + 12 months', async () => {
    const r = await owner.post<{ ok: boolean; warranty: Warranty }>('/api/warranty', {
      vin: INSTALLED_VIN,
      partSku: PART_SKU,
      startDate: '2026-01-15',
      months: 12,
      dealerId: 999999, // attempt to target another dealer — must be ignored
    })
    expect(r.status).toBe(200)
    expect(r.body.warranty.dealerId).toBe(ownerDealerId)
    expect(r.body.warranty.expiresAt).toBe('2027-01-15')
    expect(r.body.warranty.status).toBe('active')
    createdWarrantyIds.push(r.body.warranty.id)
  })

  it('invalid VIN (not in registry) → 400', async () => {
    const r = await owner.post('/api/warranty', {
      vin: 'ZZZZZZZZZZZZZZZZZ', // 17 chars, not in vins
      partSku: PART_SKU,
      startDate: '2026-01-15',
      months: 12,
    })
    expect(r.status).toBe(400)
  })
})

describe('GET /api/warranty (dealer-scoped)', () => {
  it('owner sees only own-dealer rows', async () => {
    const r = await owner.get<{ warranties: Warranty[] }>('/api/warranty')
    expect(r.status).toBe(200)
    expect(r.body.warranties.length).toBeGreaterThan(0)
    for (const w of r.body.warranties) expect(w.dealerId).toBe(ownerDealerId)
  })
})

describe('POST /api/warranty/:id/void', () => {
  let targetId = 0

  it('seed a void target as owner', async () => {
    const r = await owner.post<{ ok: boolean; warranty: Warranty }>('/api/warranty', {
      vin: INSTALLED_VIN,
      partSku: PART_SKU,
      startDate: '2026-02-01',
      months: 6,
    })
    expect(r.status).toBe(200)
    targetId = r.body.warranty.id
    createdWarrantyIds.push(targetId)
  })

  it('owner cannot void (403, admin-only)', async () => {
    const r = await owner.post(`/api/warranty/${targetId}/void`)
    expect(r.status).toBe(403)
  })

  it('admin voids → 200, status void', async () => {
    const r = await admin.post<{ ok: boolean; warranty: Warranty }>(`/api/warranty/${targetId}/void`)
    expect(r.status).toBe(200)
    expect(r.body.warranty.status).toBe('void')
  })
})
