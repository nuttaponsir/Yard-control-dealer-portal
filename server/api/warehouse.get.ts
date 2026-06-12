// GET /api/warehouse — Dev3 owns. Warehouse Kanban: orders grouped by status.
import { desc, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { requireUser } from '../utils/auth'
import { ORDER_STATUS_ORDER } from '../../app/utils/labels'
import type { Order, OrderStatus } from '../../app/types'

export interface FulfillmentCard extends Order {
  dealerName: string
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])

  const orderRows = await db
    .select()
    .from(schema.orders)
    .orderBy(desc(schema.orders.createdAt))

  // resolve dealer names in one query
  const dealerIds = [...new Set(orderRows.map((o) => o.dealerId))]
  const dealerRows = dealerIds.length
    ? await db
        .select({ id: schema.dealers.id, name: schema.dealers.name })
        .from(schema.dealers)
        .where(inArray(schema.dealers.id, dealerIds))
    : []
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  const cards: FulfillmentCard[] = orderRows.map((o) => ({
    ...(o as Order),
    dealerName: dealerName.get(o.dealerId) ?? '—',
  }))

  const columns = ORDER_STATUS_ORDER.map((status) => ({
    status,
    orders: cards.filter((c) => c.status === (status as OrderStatus)),
  }))

  return { columns }
})
