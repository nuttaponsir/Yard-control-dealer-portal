// GET /api/returns — Phase C (deferred RMA). Return list.
//  - owner/sales: scoped to their own dealer's returns
//  - admin/warehouse: all returns
// Each row is enriched with the dealer name, the order's PO number, and its
// line items (with part sku/name) for the detail view + admin decision UI.
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { Return } from '../../../app/types'

export interface ReturnItemRow {
  partId: number
  sku: string
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
}

export interface ReturnRow extends Return {
  dealerName: string | null
  poNumber: string | null
  items: ReturnItemRow[]
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null

  const rows = scoped
    ? await db.query.returns.findMany({
        where: eq(schema.returns.dealerId, user.dealerId as number),
      })
    : await db.query.returns.findMany()

  // Sort newest-first.
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const returnIds = rows.map((r) => r.id)
  const orderIds = [...new Set(rows.map((r) => r.orderId))]
  const dealerIds = [...new Set(rows.map((r) => r.dealerId))]

  const [itemRows, orderRows, dealerRows, partRows] = await Promise.all([
    returnIds.length
      ? db.query.returnItems.findMany({ where: inArray(schema.returnItems.returnId, returnIds) })
      : Promise.resolve([]),
    orderIds.length
      ? db.query.orders.findMany({ where: inArray(schema.orders.id, orderIds) })
      : Promise.resolve([]),
    dealerIds.length
      ? db.query.dealers.findMany({ where: inArray(schema.dealers.id, dealerIds) })
      : Promise.resolve([]),
    db.query.parts.findMany(),
  ])

  const poByOrder = new Map(orderRows.map((o) => [o.id, o.poNumber]))
  const nameByDealer = new Map(dealerRows.map((d) => [d.id, d.name]))
  const partById = new Map(partRows.map((p) => [p.id, p]))

  const itemsByReturn = new Map<number, ReturnItemRow[]>()
  for (const ri of itemRows) {
    const part = partById.get(ri.partId)
    const list = itemsByReturn.get(ri.returnId) ?? []
    list.push({
      partId: ri.partId,
      sku: part?.sku ?? String(ri.partId),
      name: part?.name ?? '',
      qty: ri.qty,
      unitPrice: ri.unitPrice,
      lineTotal: ri.qty * ri.unitPrice,
    })
    itemsByReturn.set(ri.returnId, list)
  }

  const returns: ReturnRow[] = rows.map((r) => ({
    ...(r as Return),
    dealerName: nameByDealer.get(r.dealerId) ?? null,
    poNumber: poByOrder.get(r.orderId) ?? null,
    items: itemsByReturn.get(r.id) ?? [],
  }))

  return { returns }
})
