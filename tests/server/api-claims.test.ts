// Test1 (QA backend) — Warranty claims.
// Covers AC-8.2 (CLM number + status submitted + amount = part price),
// AC-8.3 (newest-first recent list), AC-8.1 (purchase history by VIN).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { eq } from 'drizzle-orm'

const INSTALLED_VIN = 'MMTJNKB40NH000001'
const CLM_RE = /^CLM-\d{4}-\d{4}$/

beforeAll(async () => {
  await startServer()
})
afterAll(async () => {
  await stopServer()
})

describe('File a claim (AC-8.2)', () => {
  it('generates CLM-YYYY-NNNN, status submitted, amount = part price', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, 'MIT-BP-003') })
    const r = await wh.post<{ ok: boolean; claim: { claimNumber: string; status: string; amount: number; vin: string } }>(
      '/api/claims',
      { vin: INSTALLED_VIN, partSku: 'MIT-BP-003', reason: 'พบรอยร้าวหลังติดตั้ง' },
    )
    expect(r.status).toBe(200)
    expect(r.body.claim.claimNumber).toMatch(CLM_RE)
    expect(r.body.claim.status).toBe('submitted')
    expect(r.body.claim.amount).toBe(part!.price)
    expect(r.body.claim.vin).toBe(INSTALLED_VIN)
  })

  it('rejects an unknown SKU with 400', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const r = await wh.post('/api/claims', {
      vin: INSTALLED_VIN,
      partSku: 'NOPE-000',
      reason: 'x',
    })
    expect(r.status).toBe(400)
  })

  it('rejects a VIN that is not 17 chars (400 zod)', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const r = await wh.post('/api/claims', {
      vin: 'TOOSHORT',
      partSku: 'MIT-BP-003',
      reason: 'x',
    })
    expect(r.status).toBe(400)
  })
})

describe('Recent claims list (AC-8.3)', () => {
  it('returns claims newest-first', async () => {
    const wh = await loginAs('warehouse@demo.co')
    // file two claims so we have a deterministic ordering signal
    await wh.post('/api/claims', { vin: INSTALLED_VIN, partSku: 'MIT-OF-001', reason: 'a' })
    await wh.post('/api/claims', { vin: INSTALLED_VIN, partSku: 'MIT-AF-002', reason: 'b' })
    const r = await wh.get<{ claims: { createdAt: string }[] }>('/api/claims')
    expect(r.status).toBe(200)
    const dates = r.body.claims.map((c) => c.createdAt)
    const sorted = [...dates].sort((a, b) => b.localeCompare(a))
    expect(dates).toEqual(sorted)
  })
})

describe('Purchase history by VIN (AC-8.1)', () => {
  it('returns the parts previously ordered for that VIN', async () => {
    const wh = await loginAs('warehouse@demo.co')
    const r = await wh.get<{ vin: string; history: { sku: string; lineTotal: number; qty: number; unitPrice: number }[] }>(
      `/api/claims?vin=${INSTALLED_VIN}`,
    )
    expect(r.status).toBe(200)
    expect(r.body.vin).toBe(INSTALLED_VIN)
    expect(Array.isArray(r.body.history)).toBe(true)
    expect(r.body.history.length).toBeGreaterThan(0)
    // lineTotal must equal qty * unitPrice
    for (const h of r.body.history) {
      expect(h.lineTotal).toBe(h.qty * h.unitPrice)
    }
  })
})
