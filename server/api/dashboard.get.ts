// GET /api/dashboard — Dev1 owns.
// Role-scoped operational overview: KPI counts, daily-orders series, low-stock
// rows, and (owner/sales only) the dealer credit panel.
//  - admin/warehouse: network-wide order KPIs, no credit panel.
//  - owner/sales: scoped to the user's own dealer (incl. credit panel).
//
// All independent queries are fired in a single Promise.all wave rather than
// awaited one-by-one — on serverless + a remote (Neon) DB the per-query round
// trip dominates, so collapsing ~9 sequential round trips into one parallel
// wave is the single biggest latency win for this page.
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
  const isWms = user.role === 'admin' || user.role === 'warehouse'

  // ---- fire every independent query in parallel ----------------------------
  const orderRowsP = db.query.orders.findMany({
    where: dealerScoped && user.dealerId != null ? eq(schema.orders.dealerId, user.dealerId) : undefined,
    columns: { status: true, createdAt: true },
  })

  // low-stock table (global): qtyOnHand < reorderPoint
  const lowRowsP = db
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

  // dealer credit panel (owner/sales only)
  const dealerP =
    dealerScoped && user.dealerId != null
      ? db.query.dealers.findFirst({ where: eq(schema.dealers.id, user.dealerId) })
      : Promise.resolve(null)

  // WMS summary inputs (admin/warehouse only)
  const pickRowsP = isWms ? db.query.pickTasks.findMany({ columns: { status: true } }) : Promise.resolve([])
  const locRowsP = isWms ? db.query.storageLocations.findMany({ columns: { active: true } }) : Promise.resolve([])
  const moveRowsP = isWms
    ? db.query.stockMovements.findMany({ orderBy: [desc(schema.stockMovements.id)], limit: 6 })
    : Promise.resolve([])
  const partRowsP = isWms ? db.query.parts.findMany({ columns: { id: true, sku: true } }) : Promise.resolve([])
  const poRowsP = isWms ? db.query.purchaseOrders.findMany({ columns: { status: true } }) : Promise.resolve([])
  const warRowsP = isWms
    ? db.query.warranties.findMany({ columns: { status: true, expiresAt: true } })
    : Promise.resolve([])
  const evRowsP = isWms ? db.query.vinAccessories.findMany({ columns: { id: true } }) : Promise.resolve([])

  const [orderRows, lowRows, dealer, pickRows, locRows, moveRows, partRows, poRows, warRows, evRows] =
    await Promise.all([
      orderRowsP,
      lowRowsP,
      dealerP,
      pickRowsP,
      locRowsP,
      moveRowsP,
      partRowsP,
      poRowsP,
      warRowsP,
      evRowsP,
    ])

  // ---- KPIs ----------------------------------------------------------------
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

  // ---- dealer credit panel (owner/sales only) ------------------------------
  let credit: null | { dealerName: string; grade: string; limit: number; used: number } = null
  if (dealer) {
    credit = {
      dealerName: dealer.name,
      grade: dealer.grade,
      limit: dealer.creditLimit,
      used: dealer.creditUsed,
    }
  }

  // ---- WMS summary (admin/warehouse only) ----------------------------------
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
  if (isWms) {
    const skuById = new Map(partRows.map((p) => [p.id, p.sku]))
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
      deviceAlerts: evRows.length, // accessories installed (network-wide)
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
