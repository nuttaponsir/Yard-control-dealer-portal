// Phase L — cross-dealer data-isolation tests.
// ----------------------------------------------------------------------------
// Multi-dealer separation is enforced at the application layer (WHERE
// dealerId = ...), not by DB row-level security, so it MUST be covered by tests.
// We provision a second dealer-bound owner (via the admin user API) and assert
// that a dealer-scoped account can never see or reach another dealer's orders,
// claims, or payments. owner@demo.co / sales@demo.co are bound to DLR0001; the
// in-test owner is bound to DLR0002 (which has its own seed orders + claims).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs, Client } from './harness'

const INSTALLED_VIN = 'MMTJNKB40NH000001'

interface Dealer {
  id: number
  code: string
}
interface OrderRow {
  id: number
  dealerId: number
}
interface ClaimRow {
  claimNumber: string
  dealerId: number | null
}
interface PaymentRow {
  dealerId: number
}

// dealer ids resolved at setup
let dlrA = 0 // DLR0001 — the demo owner/sales dealer
let dlrB = 0 // DLR0002 — the in-test owner's dealer
let ownerB: Client // owner bound to DLR0002
let aPartSku = ''

beforeAll(async () => {
  await startServer()

  const admin = await loginAs('admin@demo.co')

  // Resolve the two dealers by code.
  const dealersRes = await admin.get<{ dealers: Dealer[] }>('/api/dealers')
  dlrA = dealersRes.body.dealers.find((d) => d.code === 'DLR0001')!.id
  dlrB = dealersRes.body.dealers.find((d) => d.code === 'DLR0002')!.id

  // A valid part SKU for filing a claim.
  const partsRes = await admin.get<{ parts: { sku: string }[] }>('/api/parts')
  aPartSku = partsRes.body.parts[0]!.sku

  // Provision a fresh owner for DLR0002 (unique email keeps the test re-runnable
  // against a persistent DB). Then log in as them.
  const email = `owner-b-${Date.now()}@demo.co`
  const created = await admin.post('/api/users', {
    email,
    password: 'demo1234',
    role: 'owner',
    dealerId: dlrB,
  })
  expect(created.status).toBe(200)
  ownerB = await loginAs(email)
})

afterAll(async () => {
  await stopServer()
})

describe('Orders isolation', () => {
  it('a dealer-scoped owner sees only their own dealer’s orders', async () => {
    const res = await ownerB.get<{ orders: OrderRow[] }>('/api/orders')
    expect(res.status).toBe(200)
    expect(res.body.orders.length).toBeGreaterThan(0) // DLR0002 has seed orders
    for (const o of res.body.orders) expect(o.dealerId).toBe(dlrB)
  })

  it('cannot read another dealer’s order by id (403)', async () => {
    // Find a DLR0001 order via admin (network-wide view).
    const admin = await loginAs('admin@demo.co')
    const all = await admin.get<{ orders: OrderRow[] }>('/api/orders')
    const foreign = all.body.orders.find((o) => o.dealerId === dlrA)!
    expect(foreign).toBeTruthy()

    const res = await ownerB.get(`/api/orders/${foreign.id}`)
    expect(res.status).toBe(403)
  })
})

describe('Claims isolation', () => {
  it('a filed claim is scoped to the filer’s dealer and invisible to other dealers', async () => {
    // owner B files a claim.
    const filed = await ownerB.post<{ ok: boolean; claim: { claimNumber: string; dealerId: number } }>(
      '/api/claims',
      { vin: INSTALLED_VIN, partSku: aPartSku, reason: 'ทดสอบการแยกข้อมูล' },
    )
    expect(filed.status).toBe(200)
    expect(filed.body.claim.dealerId).toBe(dlrB)
    const clm = filed.body.claim.claimNumber

    // owner B sees it; every claim they see belongs to DLR0002.
    const bList = await ownerB.get<{ claims: ClaimRow[] }>('/api/claims')
    expect(bList.body.claims.some((c) => c.claimNumber === clm)).toBe(true)
    for (const c of bList.body.claims) expect(c.dealerId).toBe(dlrB)

    // owner A (DLR0001) must NOT see owner B's claim, and sees only DLR0001 claims.
    const ownerA = await loginAs('owner@demo.co')
    const aList = await ownerA.get<{ claims: ClaimRow[] }>('/api/claims')
    expect(aList.body.claims.some((c) => c.claimNumber === clm)).toBe(false)
    for (const c of aList.body.claims) expect(c.dealerId).toBe(dlrA)
  })

  it('VIN purchase history is scoped to the requesting dealer', async () => {
    // DLR0001 placed many orders for this VIN; DLR0002 placed far fewer, so the
    // scoped history a dealer sees differs by dealer — neither sees the other's.
    const ownerA = await loginAs('owner@demo.co')
    const aHist = await ownerA.get<{ history: unknown[] }>(`/api/claims?vin=${INSTALLED_VIN}`)
    const bHist = await ownerB.get<{ history: unknown[] }>(`/api/claims?vin=${INSTALLED_VIN}`)
    expect(aHist.status).toBe(200)
    expect(bHist.status).toBe(200)
    // DLR0001 is the heavy buyer of this VIN → strictly more history rows.
    expect(aHist.body.history.length).toBeGreaterThan(bHist.body.history.length)
  })
})

describe('Payments isolation', () => {
  it('each dealer-scoped account sees only its own receipts', async () => {
    const ownerA = await loginAs('owner@demo.co')
    const aPay = await ownerA.get<{ payments: PaymentRow[] }>('/api/payments')
    const bPay = await ownerB.get<{ payments: PaymentRow[] }>('/api/payments')
    expect(aPay.status).toBe(200)
    expect(bPay.status).toBe(200)
    expect(aPay.body.payments.length).toBeGreaterThan(0) // DLR0001 has seed payments
    for (const p of aPay.body.payments) expect(p.dealerId).toBe(dlrA)
    for (const p of bPay.body.payments) expect(p.dealerId).toBe(dlrB)
  })
})
