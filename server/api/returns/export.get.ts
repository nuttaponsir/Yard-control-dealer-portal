// GET /api/returns/export — download the returns list as .xlsx.
// Mirrors GET /api/returns RBAC: owner/sales are scoped to their own dealer;
// admin/warehouse see all. One row per return (item counts flattened to scalars).
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { Return } from '../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null

  const returnRows = scoped
    ? await db.query.returns.findMany({
        where: eq(schema.returns.dealerId, user.dealerId as number),
      })
    : await db.query.returns.findMany()

  returnRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const returnIds = returnRows.map((r) => r.id)
  const orderIds = [...new Set(returnRows.map((r) => r.orderId))]
  const dealerIds = [...new Set(returnRows.map((r) => r.dealerId))]

  const [itemRows, orderRows, dealerRows] = await Promise.all([
    returnIds.length
      ? db.query.returnItems.findMany({ where: inArray(schema.returnItems.returnId, returnIds) })
      : Promise.resolve([]),
    orderIds.length
      ? db.query.orders.findMany({ where: inArray(schema.orders.id, orderIds) })
      : Promise.resolve([]),
    dealerIds.length
      ? db.query.dealers.findMany({ where: inArray(schema.dealers.id, dealerIds) })
      : Promise.resolve([]),
  ])

  const poByOrder = new Map(orderRows.map((o) => [o.id, o.poNumber]))
  const nameByDealer = new Map(dealerRows.map((d) => [d.id, d.name]))

  const qtyByReturn = new Map<number, number>()
  for (const ri of itemRows) {
    qtyByReturn.set(ri.returnId, (qtyByReturn.get(ri.returnId) ?? 0) + ri.qty)
  }

  const rows = (returnRows as Return[]).map((r) => ({
    id: r.id,
    rmaNumber: r.rmaNumber,
    orderId: r.orderId,
    poNumber: poByOrder.get(r.orderId) ?? null,
    dealerId: r.dealerId,
    dealerName: nameByDealer.get(r.dealerId) ?? null,
    itemsCount: qtyByReturn.get(r.id) ?? 0,
    reason: r.reason,
    status: r.status,
    refundAmount: r.refundAmount,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
  }))

  const columns: XlsxColumn[] = [
    { key: 'id' },
    { key: 'rmaNumber' },
    { key: 'orderId' },
    { key: 'poNumber' },
    { key: 'dealerId' },
    { key: 'dealerName' },
    { key: 'itemsCount' },
    { key: 'reason' },
    { key: 'status' },
    { key: 'refundAmount' },
    { key: 'decidedBy' },
    { key: 'decidedAt' },
    { key: 'createdAt' },
  ]

  const buf = await buildXlsx(columns, rows, 'returns')
  return sendXlsx(event, buf, `returns-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
