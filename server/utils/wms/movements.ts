// ============================================================================
// Phase 3 — stock movement ledger helper.
// ----------------------------------------------------------------------------
// Posts a row to stock_movements. The ledger is a faithful record of WHY
// inventory.qtyOnHand changed — it does NOT mutate qtyOnHand itself; callers do
// that in the same transaction. `qty` is signed: +adds to on-hand, −removes.
// Accepts either the top-level db or an in-flight transaction so it can join an
// existing atomic operation (e.g. order placement, return approval).
// ============================================================================
import { db, schema } from '../../db'
import type { StockMovementKind } from '../../../app/types'

type Db = typeof db
export type MovementTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export interface PostMovementInput {
  partId: number
  warehouse: string
  kind: StockMovementKind
  qty: number // signed
  locationId?: number | null
  refType?: string | null
  refId?: string | null
  note?: string | null
  createdBy?: number | null
}

/** Append one row to the stock-movement ledger. Returns the inserted row. */
export async function postMovement(tx: MovementTx, input: PostMovementInput) {
  const [row] = await tx
    .insert(schema.stockMovements)
    .values({
      partId: input.partId,
      warehouse: input.warehouse,
      locationId: input.locationId ?? null,
      kind: input.kind,
      qty: input.qty,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: new Date().toISOString(),
    })
    .returning()
  return row!
}
