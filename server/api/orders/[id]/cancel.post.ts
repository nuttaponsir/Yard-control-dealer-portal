// POST /api/orders/:id/cancel — Phase C. Cancel an order and undo its side
// effects: restore the decremented stock and release the reserved credit.
// Only the owning dealer's owner/sales may cancel, and only while the order is
// still early in the pipeline (pending | confirming) — once it ships, no undo.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'
import { postMovement } from '../../../utils/wms'
import type { OrderStatus } from '../../../../app/types'

const CANCELLABLE: OrderStatus[] = ['pending', 'confirming']

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['owner', 'sales'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสคำสั่งซื้อไม่ถูกต้อง' })
  }

  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, id) })
  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบคำสั่งซื้อ' })
  }
  // Dealer scoping: a dealer can only cancel its own orders.
  if (user.dealerId == null || order.dealerId !== user.dealerId) {
    throw createError({ statusCode: 403, statusMessage: 'ไม่มีสิทธิ์ยกเลิกคำสั่งซื้อนี้' })
  }
  if (!CANCELLABLE.includes(order.status as OrderStatus)) {
    throw createError({
      statusCode: 409,
      statusMessage: `ยกเลิกไม่ได้: คำสั่งซื้ออยู่ในสถานะ "${order.status}" แล้ว`,
    })
  }

  const orderItems = await db.query.orderItems.findMany({
    where: eq(schema.orderItems.orderId, id),
  })

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.orders)
      .set({ status: 'cancelled' })
      .where(eq(schema.orders.id, id))
      .returning()

    // Restore stock: add each line's qty back to the part's first inventory row.
    for (const item of orderItems) {
      const inv = await tx.query.inventory.findFirst({
        where: eq(schema.inventory.partId, item.partId),
      })
      if (inv) {
        await tx
          .update(schema.inventory)
          .set({ qtyOnHand: inv.qtyOnHand + item.qty })
          .where(eq(schema.inventory.id, inv.id))
        // Ledger: record the restock from cancelling the order.
        await postMovement(tx, {
          partId: item.partId,
          warehouse: inv.warehouse,
          kind: 'receipt',
          qty: item.qty,
          refType: 'order',
          refId: order.poNumber,
          note: 'ยกเลิกคำสั่งซื้อ',
          createdBy: user.id,
        })
      }
    }

    // Release credit (never let creditUsed dip below 0).
    const dealer = await tx.query.dealers.findFirst({
      where: eq(schema.dealers.id, order.dealerId),
    })
    if (dealer) {
      const released = Math.max(0, dealer.creditUsed - order.totalValue)
      await tx
        .update(schema.dealers)
        .set({ creditUsed: released })
        .where(eq(schema.dealers.id, order.dealerId))
    }

    return row!
  })

  await writeAudit(
    user.id,
    'order.cancel',
    'order',
    String(id),
    `po=${order.poNumber} restored=${order.totalValue}`,
  )

  return { ok: true, order: updated }
})
