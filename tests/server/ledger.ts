// Test helper: keep the shared stock_movements ledger at its seeded baseline.
// Order/return/cancel flows now post ledger rows; suites that exercise them
// capture the high-water id in beforeAll and delete anything above it in
// afterAll, so the ledger (and the demo dashboard's recent-movements feed) is
// left exactly as seeded — without needing to track individual PO/RMA numbers.
import { gt } from 'drizzle-orm'
import { db, schema } from '../../server/db'

/** Highest stock_movements id currently present (the seed baseline). */
export async function ledgerHighWater(): Promise<number> {
  const rows = await db.query.stockMovements.findMany({ columns: { id: true } })
  return rows.reduce((max, r) => Math.max(max, r.id), 0)
}

/** Delete every stock_movements row created after the captured baseline. */
export async function cleanupLedgerAbove(id: number): Promise<void> {
  await db.delete(schema.stockMovements).where(gt(schema.stockMovements.id, id))
}
