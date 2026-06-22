// GET /api/dashboard — Dev1 owns.
// Role-scoped operational overview: KPI counts, daily-orders series, low-stock
// rows, and (owner/sales only) the dealer credit panel.
//  - admin/warehouse: network-wide order KPIs, no credit panel.
//  - owner/sales: scoped to the user's own dealer (incl. credit panel).
import { desc, eq, lt } from 'drizzle-orm'
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

  // ---- WMS summary (admin/warehouse only) ----------------------------------
  // Pick-task status counts, active-bin count, and a recent-movements feed for
  // the warehouse overview. Null for dealer-scoped roles (no WMS access).
  let wms:
    | null
    | {
        picks: { open: number; inProgress: number; picked: number }
        activeLocations: number
        openPurchaseOrders: number
        expiringWarranties: number
        deviceAlerts: number
        recentMovements: {
          partSku: string | null
          warehouse: string
          kind: string
          qty: number
          createdAt: string
        }[]
      } = null
  if (user.role === 'admin' || user.role === 'warehouse') {
    const pickRows = await db.query.pickTasks.findMany({ columns: { status: true } })
    const locRows = await db.query.storageLocations.findMany({ columns: { active: true } })
    const moveRows = await db.query.stockMovements.findMany({
      orderBy: [desc(schema.stockMovements.id)],
      limit: 6,
    })
    const partRows = await db.query.parts.findMany({ columns: { id: true, sku: true } })
    const skuById = new Map(partRows.map((p) => [p.id, p.sku]))

    // Phase 5 module tiles: inbound POs awaiting receipt, warranties expiring in
    // the next 60 days, and unresolved device alerts (warning/critical events).
    const poRows = await db.query.purchaseOrders.findMany({ columns: { status: true } })
    const warRows = await db.query.warranties.findMany({ columns: { status: true, expiresAt: true } })
    const evRows = await db.query.telematicsEvents.findMany({ columns: { severity: true } })
    const todayStr = new Date().toISOString().slice(0, 10)
    const soonStr = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)

    wms = {
      picks: {
        open: pickRows.filter((p) => p.status === 'open').length,
        inProgress: pickRows.filter((p) => p.status === 'assigned' || p.status === 'picking').length,
        picked: pickRows.filter((p) => p.status === 'picked').length,
      },
      activeLocations: locRows.filter((l) => l.active).length,
      openPurchaseOrders: poRows.filter((p) => p.status === 'ordered' || p.status === 'partial').length,
      expiringWarranties: warRows.filter(
        (w) => w.status === 'active' && w.expiresAt >= todayStr && w.expiresAt <= soonStr,
      ).length,
      deviceAlerts: evRows.filter((e) => e.severity === 'warning' || e.severity === 'critical').length,
      recentMovements: moveRows.map((m) => ({
        partSku: skuById.get(m.partId) ?? null,
        warehouse: m.warehouse,
        kind: m.kind,
        qty: m.qty,
        createdAt: m.createdAt,
      })),
    }
  }

  return { kpis, dailyOrders, lowStock: lowRows, credit, wms }
})
