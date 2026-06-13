// POST /api/addresses — Phase 2. Create a dealer address (bill-to / ship-to).
// Dealer-scoped: owner/sales create for their own dealer; admin must pass
// dealerId. Setting a default-billing/shipping flag clears that flag on the
// dealer's other addresses (one default each) inside a transaction.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import {
  addressCreateSchema,
  resolveDealerId,
  clearDefaultFlags,
} from '../../utils/address'
import type { DealerAddress } from '../../../app/types'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'owner', 'sales'])
  const body = await parseBody(event, addressCreateSchema)
  const dealerId = resolveDealerId(user, body.dealerId)

  // The target dealer must exist (admin can pass any id).
  const dealer = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dealerId) })
  if (!dealer) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่พบดีลเลอร์ที่ระบุ' })
  }

  const now = new Date().toISOString()

  const created = await db.transaction(async (tx) => {
    if (body.isDefaultBilling || body.isDefaultShipping) {
      await clearDefaultFlags(tx, dealerId, {
        billing: body.isDefaultBilling,
        shipping: body.isDefaultShipping,
      })
    }
    const [row] = await tx
      .insert(schema.dealerAddresses)
      .values({
        dealerId,
        label: body.label,
        kind: body.kind,
        line1: body.line1,
        subDistrict: body.subDistrict ?? null,
        district: body.district ?? null,
        province: body.province,
        postalCode: body.postalCode ?? null,
        country: body.country,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        contactName: body.contactName ?? null,
        contactPhone: body.contactPhone ?? null,
        isDefaultBilling: body.isDefaultBilling,
        isDefaultShipping: body.isDefaultShipping,
        createdAt: now,
        updatedAt: null,
      })
      .returning()
    return row!
  })

  await writeAudit(user.id, 'address.create', 'address', String(created.id), `dealerId=${dealerId}`)

  return { ok: true, address: created as DealerAddress }
})
