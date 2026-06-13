// PUT /api/addresses/:id — Phase 2. Update a dealer address (partial). Same
// dealer-scoping as create. Promoting a row to default-billing/shipping clears
// that flag on the dealer's other rows in the same transaction. The owning
// dealerId is immutable (addresses cannot be reassigned to another dealer).
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import {
  addressUpdateSchema,
  assertAddressAccess,
  clearDefaultFlags,
} from '../../utils/address'
import type { DealerAddress } from '../../../app/types'

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

  const body = await parseBody(event, addressUpdateSchema)

  // Build a patch of only the provided keys (null clears optional fields).
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  for (const key of [
    'label',
    'kind',
    'line1',
    'subDistrict',
    'district',
    'province',
    'postalCode',
    'country',
    'lat',
    'lng',
    'contactName',
    'contactPhone',
    'isDefaultBilling',
    'isDefaultShipping',
  ] as const) {
    if (key in body) patch[key] = (body as Record<string, unknown>)[key] ?? null
  }

  const updated = await db.transaction(async (tx) => {
    const promoteBilling = body.isDefaultBilling === true
    const promoteShipping = body.isDefaultShipping === true
    if (promoteBilling || promoteShipping) {
      await clearDefaultFlags(tx, existing.dealerId, {
        billing: promoteBilling,
        shipping: promoteShipping,
        keepId: id,
      })
    }
    const [row] = await tx
      .update(schema.dealerAddresses)
      .set(patch)
      .where(eq(schema.dealerAddresses.id, id))
      .returning()
    return row!
  })

  await writeAudit(user.id, 'address.update', 'address', String(id), `dealerId=${existing.dealerId}`)

  return { ok: true, address: updated as DealerAddress }
})
