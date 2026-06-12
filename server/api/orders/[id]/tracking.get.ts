// GET /api/orders/[id]/tracking — Phase E. Carrier tracking timeline for an
// order (mock Flash/SCG providers). Dealer-scoped exactly like orders/[id].get:
// owner/sales may only read their own dealer's orders; admin/warehouse read any.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { getTracking, type TrackingResult } from '../../../utils/carriers'

export default defineEventHandler(async (event): Promise<TrackingResult> => {
  const user = await requireUser(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสคำสั่งซื้อไม่ถูกต้อง' })
  }

  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, id) })
  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบคำสั่งซื้อ' })
  }

  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null
  if (scoped && order.dealerId !== user.dealerId) {
    throw createError({ statusCode: 403, statusMessage: 'ไม่มีสิทธิ์เข้าถึงคำสั่งซื้อนี้' })
  }

  return getTracking({
    status: order.status,
    trackingNo: order.trackingNo,
    carrier: order.carrier,
    createdAt: order.createdAt,
  })
})
