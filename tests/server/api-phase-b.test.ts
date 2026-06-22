// Phase B regression tests — Master Data Layer + audit logging.
//   1. Master CRUD API (/api/masters/:entity): admin-only; unknown entity 404;
//      create/update/delete on an editable master; read-only master rejects writes.
//   2. Audit log: core mutations (order create, fulfillment advance) write an
//      audit_log row via the best-effort writeAudit helper.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { eq, and } from 'drizzle-orm'
import { ledgerHighWater, cleanupLedgerAbove } from './ledger'

const INSTALLED_VIN = 'MMTJNKB40NH000001'

let ledgerMark = 0
beforeAll(async () => {
  await startServer()
  ledgerMark = await ledgerHighWater()
})
afterAll(async () => {
  await cleanupLedgerAbove(ledgerMark)
  await stopServer()
})

async function partIdBySku(sku: string): Promise<number> {
  const p = await db.query.parts.findFirst({ where: eq(schema.parts.sku, sku) })
  return p!.id
}

describe('Master CRUD API — RBAC & routing', () => {
  it('admin can list a master entity', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ rows?: unknown[] } | unknown[]>('/api/masters/suppliers')
    expect(r.status).toBe(200)
  })

  it('non-admin (sales) is blocked from masters (403)', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.get('/api/masters/suppliers')
    expect(r.status).toBe(403)
  })

  it('unknown entity returns 404', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get('/api/masters/not_a_real_table')
    expect(r.status).toBe(404)
  })
})

describe('Master CRUD API — create / update / delete (editable master)', () => {
  it('creates, updates, then deletes a carrier', async () => {
    const admin = await loginAs('admin@demo.co')
    const code = `TST${Date.now() % 100000}`

    const created = await admin.post<{ row?: { id: number }; id?: number }>(
      '/api/masters/carriers',
      { code, name: 'Test Carrier' },
    )
    expect([200, 201]).toContain(created.status)
    // resolve the new id from the DB regardless of response shape
    const row = await db.query.carriers.findFirst({ where: eq(schema.carriers.code, code) })
    expect(row).toBeTruthy()
    const id = row!.id

    const updated = await admin.put(`/api/masters/carriers/${id}`, { name: 'Renamed Carrier' })
    expect(updated.status).toBe(200)
    const after = await db.query.carriers.findFirst({ where: eq(schema.carriers.id, id) })
    expect(after!.name).toBe('Renamed Carrier')

    const del = await admin.delete(`/api/masters/carriers/${id}`)
    expect([200, 204]).toContain(del.status)
    const gone = await db.query.carriers.findFirst({ where: eq(schema.carriers.id, id) })
    expect(gone).toBeFalsy()
  })

  it('rejects writes to a read-only master (warehouses) with 403', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post('/api/masters/warehouses', {
      code: 'ZZZ',
      name: 'คลังทดสอบ',
    })
    expect(r.status).toBe(403)
  })
})

describe('Dealers master — CRUD + server-managed fields + FK-safe delete', () => {
  it('creates a dealer (server stamps creditUsed=0 + createdAt), updates, then deletes it', async () => {
    const admin = await loginAs('admin@demo.co')
    const code = `DLR${Date.now() % 100000}`

    const created = await admin.post('/api/masters/dealers', {
      code,
      name: 'ดีลเลอร์ทดสอบ',
      province: 'กรุงเทพมหานคร',
      phone: '021234567',
      grade: 'B',
      creditLimit: 500000,
      // attempt to set server-managed fields — must be ignored
      creditUsed: 999999,
    })
    expect([200, 201]).toContain(created.status)

    const row = await db.query.dealers.findFirst({ where: eq(schema.dealers.code, code) })
    expect(row).toBeTruthy()
    expect(row!.creditUsed).toBe(0) // server-stamped, client value ignored
    expect(row!.createdAt).toBeTruthy()
    const id = row!.id

    const updated = await admin.put(`/api/masters/dealers/${id}`, { creditLimit: 750000 })
    expect(updated.status).toBe(200)
    const after = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, id) })
    expect(after!.creditLimit).toBe(750000)

    const del = await admin.delete(`/api/masters/dealers/${id}`)
    expect([200, 204]).toContain(del.status)
    const gone = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, id) })
    expect(gone).toBeFalsy()
  })

  it('refuses to delete a dealer that still has an order (409)', async () => {
    const admin = await loginAs('admin@demo.co')
    const code = `DLR${(Date.now() + 1) % 100000}`

    await admin.post('/api/masters/dealers', {
      code,
      name: 'ดีลเลอร์มีออเดอร์',
      province: 'กรุงเทพมหานคร',
      phone: '021234567',
      grade: 'A',
      creditLimit: 100000,
    })
    const dealer = await db.query.dealers.findFirst({ where: eq(schema.dealers.code, code) })
    const dealerId = dealer!.id

    const [order] = await db
      .insert(schema.orders)
      .values({
        poNumber: `PO-2026-${String((Date.now() % 800000) + 100000).padStart(6, '0')}`,
        dealerId,
        vin: INSTALLED_VIN,
        status: 'pending',
        totalValue: 1000,
        createdAt: new Date().toISOString(),
      })
      .returning()

    const blocked = await admin.delete(`/api/masters/dealers/${dealerId}`)
    expect(blocked.status).toBe(409)
    const still = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dealerId) })
    expect(still).toBeTruthy()

    // cleanup: remove the order then the dealer
    await db.delete(schema.orders).where(eq(schema.orders.id, order!.id))
    const ok = await admin.delete(`/api/masters/dealers/${dealerId}`)
    expect([200, 204]).toContain(ok.status)
  })
})

describe('Audit log — core mutations record a row', () => {
  it('order.create writes an audit row keyed by PO number', async () => {
    const sales = await loginAs('sales@demo.co')
    const oilId = await partIdBySku('MIT-OF-001')
    const r = await sales.post<{ poNumber: string }>('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId: oilId, qty: 1 }],
    })
    expect(r.status).toBe(200)
    const po = r.body.poNumber
    const audit = await db.query.auditLog.findFirst({
      where: and(eq(schema.auditLog.action, 'order.create'), eq(schema.auditLog.entityId, po)),
    })
    expect(audit).toBeTruthy()
    expect(audit!.entity).toBe('order')
    expect(audit!.userId).toBeTruthy()
  })

  it('order.advance writes an audit row when fulfillment moves a step', async () => {
    // seed a fresh pending order directly
    const dealer = await db.query.dealers.findFirst()
    const [order] = await db
      .insert(schema.orders)
      .values({
        poNumber: `PO-2026-${String(Date.now() % 900000 + 90000).padStart(6, '0')}`,
        dealerId: dealer!.id,
        vin: INSTALLED_VIN,
        status: 'pending',
        totalValue: 1000,
        createdAt: new Date().toISOString(),
      })
      .returning()

    const wh = await loginAs('warehouse@demo.co')
    const adv = await wh.patch(`/api/warehouse/${order!.id}`, { status: 'confirming' })
    expect(adv.status).toBe(200)

    const audit = await db.query.auditLog.findFirst({
      where: and(
        eq(schema.auditLog.action, 'order.advance'),
        eq(schema.auditLog.entityId, String(order!.id)),
      ),
    })
    expect(audit).toBeTruthy()
    expect(audit!.entity).toBe('order')
  })
})
