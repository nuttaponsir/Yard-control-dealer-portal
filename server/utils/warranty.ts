// ============================================================================
// Phase 5 (#7) — auto-register part warranties when an order is delivered.
// ----------------------------------------------------------------------------
// On →delivered the fulfillment handler calls registerWarrantiesForOrder(): one
// warranty per ordered part that carries warrantyMonths > 0, tied to the order's
// VIN + dealer, coverage = the part's warrantyMonths from the catalog. Idempotent
// per VIN+SKU (an active warranty for the same vehicle+part is not duplicated)
// and best-effort — it must never fail the status advance.
// ============================================================================
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { writeAudit } from './audit'

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

/**
 * Create active warranties for an order's parts. Returns the number created.
 * Skips parts with no warranty period and VIN+SKU pairs already covered.
 */
export async function registerWarrantiesForOrder(
  orderId: number,
  actorId?: number | null,
): Promise<number> {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) })
  if (!order) return 0

  const items = await db.query.orderItems.findMany({
    where: eq(schema.orderItems.orderId, orderId),
  })
  if (!items.length) return 0

  const partRows = await db.query.parts.findMany({
    where: inArray(schema.parts.id, items.map((i) => i.partId)),
  })
  const partById = new Map(partRows.map((p) => [p.id, p]))

  // Already-covered (active) SKUs for this VIN — don't duplicate.
  const existing = await db.query.warranties.findMany({
    where: eq(schema.warranties.vin, order.vin),
  })
  const covered = new Set(existing.filter((w) => w.status === 'active').map((w) => w.partSku))

  // Continue the WAR-2026-###### sequence past whatever exists.
  const allWar = await db.query.warranties.findMany({ columns: { warrantyNo: true } })
  let seq = allWar.reduce((max, w) => {
    const m = /^WAR-2026-(\d{6})$/.exec(w.warrantyNo)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  const rows: (typeof schema.warranties.$inferInsert)[] = []
  for (const it of items) {
    const part = partById.get(it.partId)
    if (!part || part.warrantyMonths <= 0) continue
    if (covered.has(part.sku)) continue
    covered.add(part.sku)
    seq++
    rows.push({
      warrantyNo: `WAR-2026-${pad(seq, 6)}`,
      vin: order.vin,
      partSku: part.sku,
      dealerId: order.dealerId,
      startDate: today,
      months: part.warrantyMonths,
      expiresAt: addMonths(today, part.warrantyMonths),
      status: 'active',
      note: `ออกอัตโนมัติจากคำสั่งซื้อ ${order.poNumber}`,
      createdBy: actorId ?? null,
      createdAt: now,
    })
  }

  if (rows.length) {
    await db.insert(schema.warranties).values(rows)
    await writeAudit(actorId ?? null, 'warranty.auto', 'order', order.poNumber, `created ${rows.length}`)
  }
  return rows.length
}
