// GET /api/warranty — Phase 5. List part-warranty registrations (newest first).
// Dealer-scoped: owner/sales see only their own dealer's warranties;
// admin/warehouse see the whole network.
import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { Warranty } from '../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'owner', 'sales', 'warehouse'])

  // owner/sales are scoped to their own dealer; admin/warehouse see all.
  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null

  const warranties = (await db.query.warranties.findMany({
    where: scoped ? eq(schema.warranties.dealerId, user.dealerId as number) : undefined,
    orderBy: desc(schema.warranties.id),
  })) as Warranty[]

  return { warranties }
})
