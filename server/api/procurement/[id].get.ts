// GET /api/procurement/:id — Phase 5 (Procurement). One purchase order plus its
// line items (each enriched with the part's SKU + name) and the supplier name.
// Warehouse-level access (admin/warehouse), NOT dealer-scoped.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { PurchaseOrder, PurchaseOrderItem } from '../../../app/types'

export interface PurchaseOrderItemRow extends PurchaseOrderItem {
  partSku: string
  partName: string
}

export interface PurchaseOrderDetail {
  purchaseOrder: PurchaseOrder
  supplierName: string
  items: PurchaseOrderItemRow[]
}

export default defineEventHandler(async (event): Promise<PurchaseOrderDetail> => {
  await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสใบสั่งซื้อไม่ถูกต้อง' })
  }

  const po = await db.query.purchaseOrders.findFirst({
    where: eq(schema.purchaseOrders.id, id),
  })
  if (!po) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบใบสั่งซื้อ' })
  }

  const supplier = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.id, po.supplierId),
  })

  const lines = await db.query.purchaseOrderItems.findMany({
    where: eq(schema.purchaseOrderItems.purchaseOrderId, id),
  })
  const parts = await db.query.parts.findMany()
  const partById = new Map(parts.map((p) => [p.id, p]))

  const items: PurchaseOrderItemRow[] = lines.map((l) => {
    const part = partById.get(l.partId)
    return {
      ...(l as PurchaseOrderItem),
      partSku: part?.sku ?? String(l.partId),
      partName: part?.name ?? '',
    }
  })

  return {
    purchaseOrder: po as PurchaseOrder,
    supplierName: supplier?.name ?? String(po.supplierId),
    items,
  }
})
