// GET /api/orders — Dev2 owns. Purchase-order list. owner/sales are scoped to
// their own dealer; admin & warehouse see all. Each order is enriched with its
// dealer name for the table.
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { readPagination, paginate } from '../../utils/pagination'
import type { Order } from '../../../app/types'

export interface OrderRow extends Order {
  dealerName: string | null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const query = getQuery(event)
  // Optional ?vin= filter (uppercase, exact match) — used by the claim-create
  // order picker. Composed with the dealer-scoping below.
  const vinParam = typeof query.vin === 'string' ? query.vin.trim().toUpperCase() : undefined

  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null

  const conditions = [
    scoped ? eq(schema.orders.dealerId, user.dealerId as number) : undefined,
    vinParam ? eq(schema.orders.vin, vinParam) : undefined,
  ].filter(Boolean)

  const orderRows = conditions.length
    ? await db.query.orders.findMany({ where: and(...(conditions as any[])) })
    : await db.query.orders.findMany()

  const dealerRows = await db.query.dealers.findMany()
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  const orders: OrderRow[] = orderRows
    .map((o) => ({ ...(o as Order), dealerName: dealerName.get(o.dealerId) ?? null }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  // Opt-in pagination: only when ?page/?limit is sent (preserves legacy shape).
  const pagination = readPagination(event)
  if (pagination) {
    const { items, meta } = paginate(orders, pagination)
    return { orders: items, meta }
  }

  return { orders }
})
