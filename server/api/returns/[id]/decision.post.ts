// POST /api/returns/:id/decision — Phase C (deferred RMA). Admin approves or
// rejects a pending return request.
//   approve → status 'approved'; restock each returned line (inventory += qty)
//             and release the dealer's credit (creditUsed -= refundAmount),
//             all inside one transaction.
//   reject  → status 'rejected'; no stock/credit movement.
// Only 'requested' returns can be decided; deciding again is a 409.
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'
import { notify } from '../../../utils/notify'

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสรายการคืนไม่ถูกต้อง' })
  }

  const { decision } = await parseBody(event, decisionSchema)

  const ret = await db.query.returns.findFirst({ where: eq(schema.returns.id, id) })
  if (!ret) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบรายการคืนสินค้า' })
  }
  if (ret.status !== 'requested') {
    throw createError({
      statusCode: 409,
      statusMessage: `ตัดสินใจไม่ได้: รายการคืนอยู่ในสถานะ "${ret.status}" แล้ว`,
    })
  }

  const now = new Date().toISOString()

  if (decision === 'reject') {
    const [row] = await db
      .update(schema.returns)
      .set({ status: 'rejected', decidedBy: user.id, decidedAt: now })
      .where(eq(schema.returns.id, id))
      .returning()
    await writeAudit(user.id, 'return.reject', 'return', ret.rmaNumber, `orderId=${ret.orderId}`)
    await notify({
      event: 'return.rejected',
      entity: 'return',
      entityId: ret.rmaNumber,
      dealerId: ret.dealerId,
      vars: { rma: ret.rmaNumber },
    })
    return { ok: true, return: row! }
  }

  // approve — restock + release credit atomically.
  const items = await db.query.returnItems.findMany({
    where: eq(schema.returnItems.returnId, id),
  })

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.returns)
      .set({ status: 'approved', decidedBy: user.id, decidedAt: now })
      .where(eq(schema.returns.id, id))
      .returning()

    // Restock: add each returned line's qty back to the part's first inventory
    // row (mirrors the order-cancel restore path).
    for (const it of items) {
      const inv = await tx.query.inventory.findFirst({
        where: eq(schema.inventory.partId, it.partId),
      })
      if (inv) {
        await tx
          .update(schema.inventory)
          .set({ qtyOnHand: sql`${schema.inventory.qtyOnHand} + ${it.qty}` })
          .where(eq(schema.inventory.id, inv.id))
      }
    }

    // Release credit (never below 0).
    const dealer = await tx.query.dealers.findFirst({
      where: eq(schema.dealers.id, ret.dealerId),
    })
    if (dealer) {
      const released = Math.max(0, dealer.creditUsed - ret.refundAmount)
      await tx
        .update(schema.dealers)
        .set({ creditUsed: released })
        .where(eq(schema.dealers.id, ret.dealerId))
    }

    return row!
  })

  await writeAudit(
    user.id,
    'return.approve',
    'return',
    ret.rmaNumber,
    `orderId=${ret.orderId} refund=${ret.refundAmount}`,
  )

  await notify({
    event: 'return.approved',
    entity: 'return',
    entityId: ret.rmaNumber,
    dealerId: ret.dealerId,
    vars: { rma: ret.rmaNumber, refund: ret.refundAmount },
  })

  return { ok: true, return: updated }
})
