// GET /api/warehouse/export — Phase K. Download the warehouse fulfillment queue
// as .xlsx. Mirrors /api/warehouse RBAC exactly: admin & warehouse only. Returns
// the same order set the Kanban board shows, flattened to one scalar row per
// order (newest first), enriched with the resolving dealer name.
import { desc, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { Order } from '../../../app/types'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])

  const orderRows = await db
    .select()
    .from(schema.orders)
    .orderBy(desc(schema.orders.createdAt))

  const dealerIds = [...new Set(orderRows.map((o) => o.dealerId))]
  const dealerRows = dealerIds.length
    ? await db
        .select({ id: schema.dealers.id, name: schema.dealers.name })
        .from(schema.dealers)
        .where(inArray(schema.dealers.id, dealerIds))
    : []
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  const rows = orderRows
    .map((o) => o as Order)
    .map((o) => ({
      poNumber: o.poNumber,
      dealer: dealerName.get(o.dealerId) ?? null,
      vin: o.vin,
      status: o.status,
      totalValue: o.totalValue,
      paymentStatus: o.paymentStatus,
      invoiceNo: o.invoiceNo,
      carrier: o.carrier,
      trackingNo: o.trackingNo,
      createdAt: new Date(o.createdAt).toISOString().slice(0, 10),
    }))

  const columns: XlsxColumn[] = [
    { key: 'poNumber' },
    { key: 'dealer' },
    { key: 'vin' },
    { key: 'status' },
    { key: 'totalValue' },
    { key: 'paymentStatus' },
    { key: 'invoiceNo' },
    { key: 'carrier' },
    { key: 'trackingNo' },
    { key: 'createdAt' },
  ]

  const buf = await buildXlsx(columns, rows, 'warehouse')
  return sendXlsx(event, buf, `warehouse-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
