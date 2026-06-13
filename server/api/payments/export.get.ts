// GET /api/payments/export — Phase K. Download the current user's payment-
// receipt list as .xlsx. Mirrors /api/payments RBAC exactly: owner/sales are
// scoped to their own dealer (fail CLOSED when dealerId is null); admin &
// warehouse see all. Nested fields are flattened to scalars; each row is
// enriched with its dealer name and (when applied) the order PO number.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { Payment } from '../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  // Dealer-bound roles only ever see their own dealer's receipts. Fail CLOSED:
  // a dealer-bound account with no dealerId sees nothing rather than everything.
  const dealerBound = user.role === 'owner' || user.role === 'sales'
  if (dealerBound && user.dealerId == null) {
    const buf = await buildXlsx(
      [{ key: 'receiptNo' }],
      [] as Record<string, unknown>[],
      'payments',
    )
    return sendXlsx(event, buf, `payments-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const paymentRows = dealerBound
    ? await db.query.payments.findMany({
        where: eq(schema.payments.dealerId, user.dealerId as number),
      })
    : await db.query.payments.findMany()

  const dealerRows = await db.query.dealers.findMany()
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  const orderRows = await db.query.orders.findMany()
  const poById = new Map(orderRows.map((o) => [o.id, o.poNumber]))

  const payments = paymentRows
    .map((p) => p as Payment)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

  const rows = payments.map((p) => ({
    receiptNo: p.receiptNo,
    dealer: dealerName.get(p.dealerId) ?? null,
    poNumber: p.orderId != null ? (poById.get(p.orderId) ?? null) : null,
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    note: p.note,
    receivedAt: new Date(p.receivedAt).toISOString().slice(0, 10),
    createdAt: new Date(p.createdAt).toISOString().slice(0, 10),
  }))

  const columns: XlsxColumn[] = [
    { key: 'receiptNo' },
    { key: 'dealer' },
    { key: 'poNumber' },
    { key: 'amount' },
    { key: 'method' },
    { key: 'reference' },
    { key: 'note' },
    { key: 'receivedAt' },
    { key: 'createdAt' },
  ]

  const buf = await buildXlsx(columns, rows, 'payments')
  return sendXlsx(event, buf, `payments-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
