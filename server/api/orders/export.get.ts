// GET /api/orders/export — Dev2 owns. Download the current user's order list as
// .xlsx. Mirrors /api/orders RBAC exactly: owner/sales are scoped to their own
// dealer; admin & warehouse see all. Nested fields are flattened to scalars and
// each row is enriched with its dealer name + line-item count.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { Order } from '../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null

  const orderRows = scoped
    ? await db.query.orders.findMany({
        where: eq(schema.orders.dealerId, user.dealerId as number),
      })
    : await db.query.orders.findMany()

  const dealerRows = await db.query.dealers.findMany()
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  // Line-item count per order (single fetch, scoped implicitly by the order set).
  const itemRows = await db.query.orderItems.findMany()
  const itemCount = new Map<number, number>()
  for (const it of itemRows) itemCount.set(it.orderId, (itemCount.get(it.orderId) ?? 0) + 1)

  const orders = orderRows
    .map((o) => o as Order)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const rows = orders.map((o) => ({
    poNumber: o.poNumber,
    dealer: dealerName.get(o.dealerId) ?? null,
    vin: o.vin,
    status: o.status,
    itemCount: itemCount.get(o.id) ?? 0,
    subtotal: o.subtotal,
    discount: o.discount,
    vat: o.vat,
    totalValue: o.totalValue,
    amountPaid: o.amountPaid,
    paymentStatus: o.paymentStatus,
    invoiceNo: o.invoiceNo,
    trackingNo: o.trackingNo,
    carrier: o.carrier,
    createdAt: new Date(o.createdAt).toISOString().slice(0, 10),
  }))

  const columns: XlsxColumn[] = [
    { key: 'poNumber' },
    { key: 'dealer' },
    { key: 'vin' },
    { key: 'status' },
    { key: 'itemCount' },
    { key: 'subtotal' },
    { key: 'discount' },
    { key: 'vat' },
    { key: 'totalValue' },
    { key: 'amountPaid' },
    { key: 'paymentStatus' },
    { key: 'invoiceNo' },
    { key: 'trackingNo' },
    { key: 'carrier' },
    { key: 'createdAt' },
  ]

  const buf = await buildXlsx(columns, rows, 'orders')
  return sendXlsx(event, buf, `orders-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
