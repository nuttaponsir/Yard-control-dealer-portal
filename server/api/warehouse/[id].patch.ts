// PATCH /api/warehouse/[id] — Dev3 owns. Advance an order's fulfillment status
// exactly one step forward (pending→confirming→packing→shipped→delivered).
// Backward moves and skips are rejected with 400. On →shipped, auto-assign a
// tracking number + carrier when missing.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import { notify } from '../../utils/notify'
import { getWmsAdapter } from '../../utils/wms'
import { ORDER_STATUS_ORDER } from '../../../app/utils/labels'
import type { OrderStatus } from '../../../app/types'

const patchSchema = z.object({
  status: z.enum(['pending', 'confirming', 'packing', 'shipped', 'delivered']),
})

const CARRIERS = ['Flash', 'SCG'] as const

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสคำสั่งซื้อไม่ถูกต้อง' })
  }

  const { status: next } = await parseBody(event, patchSchema)

  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, id),
  })
  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบคำสั่งซื้อ' })
  }

  const current = order.status as OrderStatus
  const currentIdx = ORDER_STATUS_ORDER.indexOf(current)
  const nextIdx = ORDER_STATUS_ORDER.indexOf(next as OrderStatus)

  // strict forward-only by exactly one step
  if (nextIdx !== currentIdx + 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'เปลี่ยนสถานะได้เฉพาะไปยังขั้นถัดไปทีละขั้นเท่านั้น',
    })
  }

  const patch: Partial<typeof schema.orders.$inferInsert> = { status: next }

  // when moving into shipped, ensure a tracking number + carrier exist
  if (next === 'shipped') {
    if (!order.trackingNo) patch.trackingNo = `TH${pad(20000000 + order.id * 13, 8)}`
    if (!order.carrier) patch.carrier = CARRIERS[order.id % CARRIERS.length]!
  }

  const [updated] = await db
    .update(schema.orders)
    .set(patch)
    .where(eq(schema.orders.id, id))
    .returning()

  // Best-effort audit: never blocks/fails the status advance.
  await writeAudit(user.id, 'order.advance', 'order', String(id), `${current}→${next}`)

  // Phase 3 — WMS hand-off when the order enters 'packing'. The adapter
  // (internal → generate pick task; external → dispatch) is best-effort and
  // must never fail the status advance.
  if (next === 'packing') {
    const lines = await db.query.orderItems.findMany({
      where: eq(schema.orderItems.orderId, id),
    })
    const adapter = await getWmsAdapter()
    await adapter.onOrderPacking({
      orderId: id,
      poNumber: updated!.poNumber,
      dealerId: updated!.dealerId,
      lines: lines.map((l) => ({ partId: l.partId, qty: l.qty })),
      actorId: user.id,
    })
  }

  // Notify the dealer on shipment + delivery milestones (best-effort).
  if (next === 'shipped' || next === 'delivered') {
    await notify({
      event: next === 'shipped' ? 'order.shipped' : 'order.delivered',
      entity: 'order',
      entityId: updated!.poNumber,
      dealerId: updated!.dealerId,
      vars: {
        po: updated!.poNumber,
        carrier: updated!.carrier ?? '-',
        tracking: updated!.trackingNo ?? '-',
      },
    })
  }

  return { order: updated }
})
