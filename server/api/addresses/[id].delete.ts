// DELETE /api/addresses/:id — Phase 2. Remove a dealer address. Same scoping as
// update. Blocked (409) when an order still references the address as its
// ship-to / bill-to, so historical orders never lose their address link.
import { eq, or } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { writeAudit } from '../../utils/audit'
import { assertAddressAccess } from '../../utils/address'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'owner', 'sales'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสที่อยู่ไม่ถูกต้อง' })
  }

  const existing = await db.query.dealerAddresses.findFirst({
    where: eq(schema.dealerAddresses.id, id),
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบที่อยู่' })
  }
  assertAddressAccess(user, existing.dealerId)

  // Refuse to orphan an order's ship-to / bill-to reference.
  const referencing = await db.query.orders.findFirst({
    where: or(eq(schema.orders.shipToAddressId, id), eq(schema.orders.billToAddressId, id)),
  })
  if (referencing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'ลบไม่ได้: ที่อยู่นี้ถูกใช้กับคำสั่งซื้อแล้ว',
    })
  }

  await db.delete(schema.dealerAddresses).where(eq(schema.dealerAddresses.id, id))

  await writeAudit(user.id, 'address.delete', 'address', String(id), `dealerId=${existing.dealerId}`)

  return { ok: true }
})
