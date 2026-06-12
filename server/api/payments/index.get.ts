// GET /api/payments — Phase G (Accounts Receivable). Payment-receipt list.
// owner/sales are scoped to their own dealer; admin & warehouse see all. Each
// payment is enriched with its dealer name and (when applied) the order PO.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { readPagination, paginate } from '../../utils/pagination'
import type { Payment } from '../../../app/types'

export interface PaymentRow extends Payment {
  dealerName: string | null
  poNumber: string | null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  // Dealer-bound roles only ever see their own dealer's receipts. Fail CLOSED:
  // a dealer-bound account with no dealerId (shouldn't happen — coherence is
  // enforced on create/update) sees nothing rather than everything.
  const dealerBound = user.role === 'owner' || user.role === 'sales'
  if (dealerBound && user.dealerId == null) {
    return { payments: [] as PaymentRow[] }
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

  const payments: PaymentRow[] = paymentRows
    .map((p) => ({
      ...(p as Payment),
      dealerName: dealerName.get(p.dealerId) ?? null,
      poNumber: p.orderId != null ? (poById.get(p.orderId) ?? null) : null,
    }))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

  // Opt-in pagination: only when ?page/?limit is sent (preserves legacy shape).
  const pagination = readPagination(event)
  if (pagination) {
    const { items, meta } = paginate(payments, pagination)
    return { payments: items, meta }
  }

  return { payments }
})
