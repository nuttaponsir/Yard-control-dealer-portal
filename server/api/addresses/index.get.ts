// GET /api/addresses — Phase 2. List dealer addresses (bill-to / ship-to book).
// Dealer-scoped: owner/sales see only their own dealer's addresses; admin sees
// all, optionally narrowed with ?dealerId=. warehouse has no dealer context →
// empty list. Sorted by dealer, then default-billing/shipping first, then label.
import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { DealerAddress } from '../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null

  let where: ReturnType<typeof eq> | undefined
  if (scoped) {
    where = eq(schema.dealerAddresses.dealerId, user.dealerId as number)
  } else if (user.role === 'admin') {
    const q = getQuery(event).dealerId
    const dealerId = q != null ? Number(q) : NaN
    if (Number.isInteger(dealerId) && dealerId > 0) {
      where = eq(schema.dealerAddresses.dealerId, dealerId)
    }
  } else {
    // warehouse (or an unbound dealer account): no addresses to show.
    return { addresses: [] as DealerAddress[] }
  }

  const rows = await db.query.dealerAddresses.findMany({
    where,
    orderBy: [asc(schema.dealerAddresses.dealerId), asc(schema.dealerAddresses.label)],
  })

  return { addresses: rows as DealerAddress[] }
})
