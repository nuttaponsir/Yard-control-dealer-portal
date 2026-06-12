// GET /api/dashboard — Dev1 owns.
// Role-scoped operational overview: KPI counts, daily-orders series, low-stock
// rows, and (owner/sales only) the dealer credit panel.
//  - admin/warehouse: network-wide order KPIs, no credit panel.
//  - owner/sales: scoped to the user's own dealer (incl. credit panel).
import { eq, lt } from 'drizzle-orm'
import { db, schema } from '../db'
import { requireUser } from '../utils/auth'

interface DailyPoint {
  date: string // ISO yyyy-mm-dd
  count: number
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const dealerScoped = user.role === 'owner' || user.role === 'sales'

  // ---- orders (scoped for owner/sales) -------------------------------------
  const orderRows = await db.query.orders.findMany({
    where: dealerScoped && user.dealerId != null ? eq(schema.orders.dealerId, user.dealerId) : undefined,
    columns: { status: true, createdAt: true },
  })

  const kpis = {
    totalOrders: orderRows.length,
    pending: orderRows.filter((o) => o.status === 'pending').length,
    shipped: orderRows.filter((o) => o.status === 'shipped').length,
    delivered: orderRows.filter((o) => o.status === 'delivered').length,
  }

  // ---- daily-orders series over a recent window ----------------------------
  const DAYS = 30
  const buckets = new Map<string, number>()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    buckets.set(d, 0)
  }
  for (const o of orderRows) {
    const key = o.createdAt.slice(0, 10)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const dailyOrders: DailyPoint[] = [...buckets.entries()].map(([date, count]) => ({ date, count }))

  // ---- low-stock table (global): qtyOnHand < reorderPoint ------------------
  const lowRows = await db
    .select({
      sku: schema.parts.sku,
      name: schema.parts.name,
      warehouse: schema.inventory.warehouse,
      qtyOnHand: schema.inventory.qtyOnHand,
      reorderPoint: schema.inventory.reorderPoint,
    })
    .from(schema.inventory)
    .innerJoin(schema.parts, eq(schema.inventory.partId, schema.parts.id))
    .where(lt(schema.inventory.qtyOnHand, schema.inventory.reorderPoint))

  // ---- dealer credit panel (owner/sales only) ------------------------------
  let credit: null | { dealerName: string; grade: string; limit: number; used: number } = null
  if (dealerScoped && user.dealerId != null) {
    const dealer = await db.query.dealers.findFirst({
      where: eq(schema.dealers.id, user.dealerId),
    })
    if (dealer) {
      credit = {
        dealerName: dealer.name,
        grade: dealer.grade,
        limit: dealer.creditLimit,
        used: dealer.creditUsed,
      }
    }
  }

  return { kpis, dailyOrders, lowStock: lowRows, credit }
})
