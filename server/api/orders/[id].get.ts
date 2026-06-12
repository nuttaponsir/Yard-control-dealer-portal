// GET /api/orders/:id — Phase C (RMA support). Single order + its line items,
// used by the return-request UI to show what can be returned. Dealer-scoped:
// owner/sales may only read their own dealer's orders; admin/warehouse read any.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { Order } from '../../../app/types'

export interface OrderLineRow {
  partId: number
  sku: string
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
}

export interface OrderDetail {
  order: Order
  items: OrderLineRow[]
}

export default defineEventHandler(async (event): Promise<OrderDetail> => {
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

  const lines = await db.query.orderItems.findMany({
    where: eq(schema.orderItems.orderId, id),
  })
  const parts = await db.query.parts.findMany()
  const partById = new Map(parts.map((p) => [p.id, p]))

  const items: OrderLineRow[] = lines.map((l) => {
    const part = partById.get(l.partId)
    return {
      partId: l.partId,
      sku: part?.sku ?? String(l.partId),
      name: part?.name ?? '',
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.qty * l.unitPrice,
    }
  })

  return { order: order as Order, items }
})
