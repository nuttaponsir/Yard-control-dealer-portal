// ============================================================================
// Phase E — scheduled jobs
// ----------------------------------------------------------------------------
// Pure async functions that compute an operational metric and emit an
// admin-facing notification. They are wired to a real scheduler in production
// (cron / Nitro task) but are also runnable on demand via
// POST /api/jobs/[name]/run (admin) so they can be tested and triggered
// manually. Each returns its computed summary.
// ============================================================================
import { gte, lt } from 'drizzle-orm'
import { db, schema } from '../db'
import { notify } from './notify'

/** Inventory rows below their reorder point → low-stock alert to admins. */
export async function runLowStockAlert(): Promise<{ count: number }> {
  const inv = await db
    .select({ id: schema.inventory.id })
    .from(schema.inventory)
    .where(lt(schema.inventory.qtyOnHand, schema.inventory.reorderPoint))
  const count = inv.length
  if (count > 0) {
    await notify({ event: 'alert.low_stock', entity: 'system', toAdmins: true, vars: { count } })
  }
  return { count }
}

/** Dealers over a credit-utilization threshold → credit-risk alert to admins. */
export async function runCreditRiskAlert(threshold = 80): Promise<{ threshold: number; count: number }> {
  const dealers = await db.query.dealers.findMany({
    columns: { creditLimit: true, creditUsed: true },
  })
  const count = dealers.filter(
    (d) => d.creditLimit > 0 && (d.creditUsed / d.creditLimit) * 100 > threshold,
  ).length
  if (count > 0) {
    await notify({ event: 'alert.credit_risk', entity: 'system', toAdmins: true, vars: { count, pct: threshold } })
  }
  return { threshold, count }
}

/** Today's order/claim/sales rollup → daily summary to admins. */
export async function runDailySummary(): Promise<{ orders: number; claims: number; sales: number }> {
  const day = new Date().toISOString().slice(0, 10) // UTC YYYY-MM-DD
  const start = `${day}T00:00:00.000Z`
  // ISO-8601 text sorts lexically, so a >= lower bound is a clean "today" filter.
  const orderRows = await db
    .select({ status: schema.orders.status, totalValue: schema.orders.totalValue })
    .from(schema.orders)
    .where(gte(schema.orders.createdAt, start))
  const claimRows = await db
    .select({ id: schema.claims.id })
    .from(schema.claims)
    .where(gte(schema.claims.createdAt, start))

  const orders = orderRows.length
  const claims = claimRows.length
  const sales = orderRows
    .filter((o) => o.status !== 'cancelled')
    .reduce((s, o) => s + o.totalValue, 0)

  await notify({ event: 'summary.daily', entity: 'system', toAdmins: true, vars: { orders, claims, sales } })
  return { orders, claims, sales }
}

// Registry consumed by the admin trigger endpoint + scheduler.
export const JOBS = {
  'low-stock': runLowStockAlert,
  'credit-risk': () => runCreditRiskAlert(),
  'daily-summary': runDailySummary,
} as const

export type JobName = keyof typeof JOBS
