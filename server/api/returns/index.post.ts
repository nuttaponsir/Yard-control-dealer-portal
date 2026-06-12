// POST /api/returns — Phase C (deferred RMA). A dealer (owner/sales) files a
// return request against one of its own DELIVERED orders. The request lists the
// order lines + quantities to return; the refund is computed server-side from
// the order's own effective discount/VAT so a partial return is refunded
// proportionally. No stock/credit moves yet — that happens on admin approval.
import { z } from 'zod'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import { computeOrderMoney } from '../../utils/pricing'

const createReturnSchema = z.object({
  orderId: z.number().int().positive(),
  reason: z.string().min(1),
  items: z
    .array(
      z.object({
        partId: z.number().int().positive(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
})

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['owner', 'sales'])
  if (user.dealerId == null) {
    throw createError({ statusCode: 403, statusMessage: 'บัญชีนี้ไม่ได้ผูกกับดีลเลอร์' })
  }

  const { orderId, reason, items } = await parseBody(event, createReturnSchema)

  // Load the order; must belong to the requesting dealer.
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) })
  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบคำสั่งซื้อ' })
  }
  if (order.dealerId !== user.dealerId) {
    throw createError({ statusCode: 403, statusMessage: 'ไม่มีสิทธิ์คืนสินค้าของคำสั่งซื้อนี้' })
  }
  // Only delivered orders can be returned (cancel covers the pre-ship path).
  if (order.status !== 'delivered') {
    throw createError({
      statusCode: 409,
      statusMessage: `คืนสินค้าไม่ได้: คำสั่งซื้ออยู่ในสถานะ "${order.status}" (ต้องเป็น "delivered")`,
    })
  }

  // Collapse duplicate partIds in the request.
  const qtyByPart = new Map<number, number>()
  for (const it of items) qtyByPart.set(it.partId, (qtyByPart.get(it.partId) ?? 0) + it.qty)

  // Ordered quantities for this order, by part.
  const orderLines = await db.query.orderItems.findMany({
    where: eq(schema.orderItems.orderId, orderId),
  })
  const orderedByPart = new Map<number, number>()
  const priceByPart = new Map<number, number>()
  for (const l of orderLines) {
    orderedByPart.set(l.partId, (orderedByPart.get(l.partId) ?? 0) + l.qty)
    priceByPart.set(l.partId, l.unitPrice)
  }

  // Already-returned quantities (requested or approved returns on this order).
  const priorReturns = await db.query.returns.findMany({
    where: eq(schema.returns.orderId, orderId),
  })
  const openReturnIds = priorReturns.filter((r) => r.status !== 'rejected').map((r) => r.id)
  const alreadyReturned = new Map<number, number>()
  if (openReturnIds.length) {
    const priorItems = await db.query.returnItems.findMany({
      where: inArray(schema.returnItems.returnId, openReturnIds),
    })
    for (const ri of priorItems) {
      alreadyReturned.set(ri.partId, (alreadyReturned.get(ri.partId) ?? 0) + ri.qty)
    }
  }

  // Validate every requested line: part was on the order, and qty does not
  // exceed what remains returnable (ordered − already returned).
  for (const [partId, qty] of qtyByPart) {
    if (!orderedByPart.has(partId)) {
      throw createError({ statusCode: 400, statusMessage: `อะไหล่รหัส ${partId} ไม่อยู่ในคำสั่งซื้อนี้` })
    }
    const returnable = (orderedByPart.get(partId) ?? 0) - (alreadyReturned.get(partId) ?? 0)
    if (qty > returnable) {
      throw createError({
        statusCode: 409,
        statusMessage: `คืนได้ไม่เกิน ${returnable} ชิ้นสำหรับอะไหล่รหัส ${partId} (ขอคืน ${qty})`,
      })
    }
  }

  // Refund computation — reproduce the order's effective discount % and VAT %
  // from its stored money breakdown so a partial return is refunded
  // proportionally and a full return ties back to order.totalValue.
  const net = order.subtotal - order.discount
  const discountPct = order.subtotal > 0 ? (order.discount / order.subtotal) * 100 : 0
  const vatRate = net > 0 ? (order.vat / net) * 100 : 0
  const refundLines = [...qtyByPart.entries()].map(([partId, qty]) => ({
    unitPrice: priceByPart.get(partId) as number,
    qty,
  }))
  const money = computeOrderMoney(refundLines, discountPct, vatRate)
  // Never refund more than the order's grand total.
  const refundAmount = Math.min(money.total, order.totalValue)

  // Next RMA number: RMA-2026-NNNN
  const year = new Date().getFullYear()
  const [last] = await db
    .select({ rmaNumber: schema.returns.rmaNumber })
    .from(schema.returns)
    .orderBy(desc(schema.returns.id))
    .limit(1)
  const lastSeq = last ? Number(last.rmaNumber.split('-').pop()) || 0 : 0
  const rmaNumber = `RMA-${year}-${pad(lastSeq + 1, 4)}`

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.returns)
      .values({
        rmaNumber,
        orderId,
        dealerId: user.dealerId!,
        reason,
        status: 'requested',
        refundAmount,
        decidedBy: null,
        decidedAt: null,
        createdAt: new Date().toISOString(),
      })
      .returning()

    await tx.insert(schema.returnItems).values(
      [...qtyByPart.entries()].map(([partId, qty]) => ({
        returnId: row!.id,
        partId,
        qty,
        unitPrice: priceByPart.get(partId) as number,
      })),
    )
    return row!
  })

  await writeAudit(
    user.id,
    'return.create',
    'return',
    rmaNumber,
    `orderId=${orderId} po=${order.poNumber} refund=${refundAmount}`,
  )

  return { ok: true, return: created, rmaNumber, refundAmount }
})
