// Phase 2 — dealer address book (bill-to / ship-to + geo) CRUD + scoping tests.
// ----------------------------------------------------------------------------
// Exercises: dealer-scoped create/list/update/delete, the "one default each"
// invariant, lat/lng range validation, cross-dealer 403, admin network-wide
// access, delete-blocked-when-referenced, and order placement wiring the
// optional shipToAddressId / billToAddressId (rejecting a foreign address).
// All rows created here are cleaned up in afterAll so the shared DB is left
// as seeded for the next suite.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const INSTALLED_VIN = 'MMTJNKB40NH000001'

interface Dealer {
  id: number
  code: string
}
interface Address {
  id: number
  dealerId: number
  label: string
  kind: string
  isDefaultBilling: boolean
  isDefaultShipping: boolean
  lat: number | null
  lng: number | null
}

let admin: Client
let ownerA: Client // bound to DLR0001
let ownerB: Client // in-test owner bound to DLR0002
let dlrA = 0
let dlrB = 0
let partId = 0

// Track everything we create so afterAll can purge it.
const createdAddressIds: number[] = []
const createdOrderIds: number[] = []

// Captured so the suite leaves the shared DB exactly as seeded: placing real
// orders charges DLR0002 credit + decrements stock, both restored in afterAll.
let origCreditUsed = 0
const origStock = new Map<number, number>() // inventoryRowId → qtyOnHand

beforeAll(async () => {
  await startServer()
  admin = await loginAs('admin@demo.co')

  const dealers = await admin.get<{ dealers: Dealer[] }>('/api/dealers')
  dlrA = dealers.body.dealers.find((d) => d.code === 'DLR0001')!.id
  dlrB = dealers.body.dealers.find((d) => d.code === 'DLR0002')!.id

  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-OF-001') })
  partId = part!.id

  // Snapshot DLR0002 credit + this part's inventory rows for exact restore.
  const dealerB = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dlrB) })
  origCreditUsed = dealerB!.creditUsed
  const invRows = await db.query.inventory.findMany({ where: eq(schema.inventory.partId, partId) })
  for (const r of invRows) origStock.set(r.id, r.qtyOnHand)

  ownerA = await loginAs('owner@demo.co') // DLR0001

  const email = `addr-owner-${Date.now()}@demo.co`
  await admin.post('/api/users', { email, password: 'demo1234', role: 'owner', dealerId: dlrB })
  ownerB = await loginAs(email)
})

afterAll(async () => {
  // Orders first (they reference addresses), then addresses.
  if (createdOrderIds.length) {
    await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, createdOrderIds))
    await db.delete(schema.orders).where(inArray(schema.orders.id, createdOrderIds))
  }
  if (createdAddressIds.length) {
    await db
      .delete(schema.dealerAddresses)
      .where(inArray(schema.dealerAddresses.id, createdAddressIds))
  }
  // Restore DLR0002 credit + part inventory to the seeded values.
  await db
    .update(schema.dealers)
    .set({ creditUsed: origCreditUsed })
    .where(eq(schema.dealers.id, dlrB))
  for (const [id, qty] of origStock) {
    await db.update(schema.inventory).set({ qtyOnHand: qty }).where(eq(schema.inventory.id, id))
  }
  await stopServer()
})

describe('Address create + scoping', () => {
  it('owner creates an address forced to their own dealer (body dealerId ignored)', async () => {
    const r = await ownerB.post<{ ok: boolean; address: Address }>('/api/addresses', {
      dealerId: dlrA, // attempt to target another dealer — must be ignored
      label: 'คลังหลัก',
      kind: 'both',
      line1: '99 ถนนทดสอบ',
      province: 'กรุงเทพมหานคร',
      lat: 13.7563,
      lng: 100.5018,
    })
    expect(r.status).toBe(200)
    expect(r.body.address.dealerId).toBe(dlrB)
    createdAddressIds.push(r.body.address.id)
  })

  it('rejects out-of-range lat/lng with 400', async () => {
    const r = await ownerB.post('/api/addresses', {
      label: 'พิกัดผิด',
      line1: 'x',
      province: 'กรุงเทพมหานคร',
      lat: 999,
      lng: 0,
    })
    expect(r.status).toBe(400)
  })

  it('admin must specify a dealerId', async () => {
    const r = await admin.post('/api/addresses', {
      label: 'no dealer',
      line1: 'x',
      province: 'กรุงเทพมหานคร',
    })
    expect(r.status).toBe(400)
  })

  it('admin can create an address for any dealer', async () => {
    const r = await admin.post<{ ok: boolean; address: Address }>('/api/addresses', {
      dealerId: dlrA,
      label: 'แอดมินสร้างให้ A',
      line1: '1 ถนนแอดมิน',
      province: 'กรุงเทพมหานคร',
    })
    expect(r.status).toBe(200)
    expect(r.body.address.dealerId).toBe(dlrA)
    createdAddressIds.push(r.body.address.id)
  })
})

describe('Default-flag invariant (one default billing / shipping per dealer)', () => {
  it('promoting a second default-billing clears the first', async () => {
    const first = await ownerB.post<{ address: Address }>('/api/addresses', {
      label: 'บิลแรก',
      line1: 'a',
      province: 'กรุงเทพมหานคร',
      isDefaultBilling: true,
    })
    const second = await ownerB.post<{ address: Address }>('/api/addresses', {
      label: 'บิลสอง',
      line1: 'b',
      province: 'กรุงเทพมหานคร',
      isDefaultBilling: true,
    })
    createdAddressIds.push(first.body.address.id, second.body.address.id)

    const list = await ownerB.get<{ addresses: Address[] }>('/api/addresses')
    const defaults = list.body.addresses.filter((a) => a.isDefaultBilling)
    expect(defaults).toHaveLength(1)
    expect(defaults[0]!.id).toBe(second.body.address.id)
  })

  it('PUT promoting an existing row to default-shipping clears the others', async () => {
    const list = await ownerB.get<{ addresses: Address[] }>('/api/addresses')
    const target = list.body.addresses[0]!
    const r = await ownerB.put<{ ok: boolean; address: Address }>(`/api/addresses/${target.id}`, {
      isDefaultShipping: true,
    })
    expect(r.status).toBe(200)
    expect(r.body.address.isDefaultShipping).toBe(true)

    const after = await ownerB.get<{ addresses: Address[] }>('/api/addresses')
    const shippingDefaults = after.body.addresses.filter((a) => a.isDefaultShipping)
    expect(shippingDefaults).toHaveLength(1)
    expect(shippingDefaults[0]!.id).toBe(target.id)
  })
})

describe('Cross-dealer isolation', () => {
  it('owner A sees only DLR0001 addresses', async () => {
    const list = await ownerA.get<{ addresses: Address[] }>('/api/addresses')
    expect(list.status).toBe(200)
    for (const a of list.body.addresses) expect(a.dealerId).toBe(dlrA)
  })

  it('owner A cannot update an address belonging to DLR0002 (403)', async () => {
    const bList = await ownerB.get<{ addresses: Address[] }>('/api/addresses')
    const bAddr = bList.body.addresses[0]!
    const r = await ownerA.put(`/api/addresses/${bAddr.id}`, { label: 'แฮก' })
    expect(r.status).toBe(403)
  })

  it('owner A cannot delete a DLR0002 address (403)', async () => {
    const bList = await ownerB.get<{ addresses: Address[] }>('/api/addresses')
    const bAddr = bList.body.addresses[0]!
    const r = await ownerA.delete(`/api/addresses/${bAddr.id}`)
    expect(r.status).toBe(403)
  })
})

describe('Order placement wiring', () => {
  it('rejects a ship-to address that belongs to another dealer (400)', async () => {
    // Find a DLR0001 address, then have owner B try to use it.
    const aList = await ownerA.get<{ addresses: Address[] }>('/api/addresses')
    const foreign = aList.body.addresses.find((a) => a.dealerId === dlrA)!
    const r = await ownerB.post('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId, qty: 1 }],
      shipToAddressId: foreign.id,
    })
    expect(r.status).toBe(400)
  })

  it('accepts a ship-to / bill-to address owned by the dealer', async () => {
    const bList = await ownerB.get<{ addresses: Address[] }>('/api/addresses')
    const own = bList.body.addresses[0]!
    const r = await ownerB.post<{ ok: boolean; order: { id: number; shipToAddressId: number | null } }>(
      '/api/orders',
      {
        vin: INSTALLED_VIN,
        items: [{ partId, qty: 1 }],
        shipToAddressId: own.id,
        billToAddressId: own.id,
      },
    )
    expect(r.status).toBe(200)
    expect(r.body.order.shipToAddressId).toBe(own.id)
    createdOrderIds.push(r.body.order.id)
  })
})

describe('Delete guard', () => {
  it('blocks deleting an address still referenced by an order (409), allows once free', async () => {
    // Create a throwaway address, attach it to an order, then attempt delete.
    const made = await ownerB.post<{ address: Address }>('/api/addresses', {
      label: 'จะลบ',
      line1: 'z',
      province: 'กรุงเทพมหานคร',
    })
    const addrId = made.body.address.id
    createdAddressIds.push(addrId)

    const ord = await ownerB.post<{ order: { id: number } }>('/api/orders', {
      vin: INSTALLED_VIN,
      items: [{ partId, qty: 1 }],
      shipToAddressId: addrId,
    })
    const orderId = ord.body.order.id
    createdOrderIds.push(orderId)

    const blocked = await ownerB.delete(`/api/addresses/${addrId}`)
    expect(blocked.status).toBe(409)

    // Detach the order reference, then the delete should succeed.
    await db
      .update(schema.orders)
      .set({ shipToAddressId: null })
      .where(eq(schema.orders.id, orderId))
    const ok = await ownerB.delete<{ ok: boolean }>(`/api/addresses/${addrId}`)
    expect(ok.status).toBe(200)
    // Remove from cleanup list since it's already gone.
    const idx = createdAddressIds.indexOf(addrId)
    if (idx >= 0) createdAddressIds.splice(idx, 1)
  })
})
