// GET /api/procurement — Phase 5 (Procurement). List purchase orders (newest
// first). Each PO is enriched with its supplier's name and the number of line
// items it carries. Warehouse-level access (admin/warehouse), NOT dealer-scoped.
import { desc, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { PurchaseOrder } from '../../../app/types'

export interface PurchaseOrderListRow extends PurchaseOrder {
  supplierName: string
  itemCount: number
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])

  const pos = await db
    .select()
    .from(schema.purchaseOrders)
    .orderBy(desc(schema.purchaseOrders.id))

  // Resolve supplier names + per-PO item counts in two batched queries.
  const supplierIds = [...new Set(pos.map((p) => p.supplierId))]
  const suppliers = supplierIds.length
    ? await db.query.suppliers.findMany({
        where: inArray(schema.suppliers.id, supplierIds),
      })
    : []
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]))

  const poIds = pos.map((p) => p.id)
  const items = poIds.length
    ? await db.query.purchaseOrderItems.findMany({
        where: inArray(schema.purchaseOrderItems.purchaseOrderId, poIds),
      })
    : []
  const itemCountByPo = new Map<number, number>()
  for (const it of items) {
    itemCountByPo.set(it.purchaseOrderId, (itemCountByPo.get(it.purchaseOrderId) ?? 0) + 1)
  }

  const purchaseOrders: PurchaseOrderListRow[] = pos.map((p) => ({
    ...(p as PurchaseOrder),
    supplierName: supplierNameById.get(p.supplierId) ?? String(p.supplierId),
    itemCount: itemCountByPo.get(p.id) ?? 0,
  }))

  return { purchaseOrders }
})
