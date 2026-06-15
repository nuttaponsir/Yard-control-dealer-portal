// Phase 3 — WMS storage-location CRUD + scoping tests.
// ----------------------------------------------------------------------------
// Storage locations are warehouse-level (NOT dealer-scoped): admin/warehouse may
// list/create/update/delete; a dealer-scoped role (owner) is forbidden (403).
// Covers: listing the 12 seeded bins, create (valid → 200, duplicate code → 409,
// unknown warehouse → 400), PUT field update, DELETE of an unused bin, and the
// owner 403. Every row created here is removed in afterAll so the shared DB is
// left exactly as seeded for the next suite.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const BKK = 'คลังกรุงเทพ'

interface StorageLocation {
  id: number
  warehouse: string
  code: string
  zone: string | null
  aisle: string | null
  bin: string | null
  active: boolean
}

let admin: Client
let warehouse: Client
let owner: Client

// Track every bin we create so afterAll can purge it.
const createdLocationIds: number[] = []

beforeAll(async () => {
  await startServer()
  admin = await loginAs('admin@demo.co')
  warehouse = await loginAs('warehouse@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001 — dealer-scoped, must be 403
})

afterAll(async () => {
  if (createdLocationIds.length) {
    await db
      .delete(schema.storageLocations)
      .where(inArray(schema.storageLocations.id, createdLocationIds))
  }
  await stopServer()
})

describe('List seed locations', () => {
  it('warehouse role lists the 12 seeded bins', async () => {
    const r = await warehouse.get<{ locations: StorageLocation[] }>('/api/wms/locations')
    expect(r.status).toBe(200)
    expect(r.body.locations.length).toBeGreaterThanOrEqual(12)
    const codes = r.body.locations.map((l) => l.code)
    expect(codes.some((c) => c.startsWith('BKK-'))).toBe(true)
    expect(codes.some((c) => c.startsWith('CNX-'))).toBe(true)
  })

  it('admin can filter by warehouse name', async () => {
    const r = await admin.get<{ locations: StorageLocation[] }>(
      `/api/wms/locations?warehouse=${encodeURIComponent(BKK)}`,
    )
    expect(r.status).toBe(200)
    expect(r.body.locations.length).toBeGreaterThan(0)
    for (const l of r.body.locations) expect(l.warehouse).toBe(BKK)
  })
})

describe('Create location', () => {
  it('creates a bin with a unique code in a valid warehouse → 200', async () => {
    const code = `TST-${Date.now()}`
    const r = await warehouse.post<{ ok: boolean; location: StorageLocation }>('/api/wms/locations', {
      warehouse: BKK,
      code,
      zone: 'T',
      aisle: '99',
      bin: '01',
    })
    expect(r.status).toBe(200)
    expect(r.body.location.code).toBe(code)
    expect(r.body.location.warehouse).toBe(BKK)
    createdLocationIds.push(r.body.location.id)
  })

  it('rejects a duplicate code → 409', async () => {
    const code = `DUP-${Date.now()}`
    const first = await warehouse.post<{ location: StorageLocation }>('/api/wms/locations', {
      warehouse: BKK,
      code,
    })
    expect(first.status).toBe(200)
    createdLocationIds.push(first.body.location.id)

    const dup = await warehouse.post('/api/wms/locations', { warehouse: BKK, code })
    expect(dup.status).toBe(409)
  })

  it('rejects an unknown warehouse name → 400', async () => {
    const r = await warehouse.post('/api/wms/locations', {
      warehouse: 'คลังที่ไม่มีอยู่จริง',
      code: `BAD-${Date.now()}`,
    })
    expect(r.status).toBe(400)
  })
})

describe('Update + delete location', () => {
  it('PUT updates a field → 200', async () => {
    const code = `UPD-${Date.now()}`
    const made = await warehouse.post<{ location: StorageLocation }>('/api/wms/locations', {
      warehouse: BKK,
      code,
      active: true,
    })
    createdLocationIds.push(made.body.location.id)

    const r = await warehouse.put<{ ok: boolean; location: StorageLocation }>(
      `/api/wms/locations/${made.body.location.id}`,
      { active: false, zone: 'Z' },
    )
    expect(r.status).toBe(200)
    expect(r.body.location.active).toBe(false)
    expect(r.body.location.zone).toBe('Z')
  })

  it('DELETE removes an unused bin → 200', async () => {
    const code = `DEL-${Date.now()}`
    const made = await warehouse.post<{ location: StorageLocation }>('/api/wms/locations', {
      warehouse: BKK,
      code,
    })
    const id = made.body.location.id

    const r = await warehouse.delete<{ ok: boolean }>(`/api/wms/locations/${id}`)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    // Already gone — do not push to cleanup list.
  })
})

describe('Dealer-scoped role is forbidden', () => {
  it('owner cannot list locations (403)', async () => {
    const r = await owner.get('/api/wms/locations')
    expect(r.status).toBe(403)
  })

  it('owner cannot create a location (403)', async () => {
    const r = await owner.post('/api/wms/locations', { warehouse: BKK, code: `OWN-${Date.now()}` })
    expect(r.status).toBe(403)
  })
})
