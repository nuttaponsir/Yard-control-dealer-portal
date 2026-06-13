// POST /api/claims — Dev3 owns. File a warranty claim against a VIN/part.
// Generates a CLM-2026-NNNN number, status 'submitted', amount = part price.
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import { notify } from '../../utils/notify'

const claimSchema = z.object({
  vin: z.string().length(17),
  partSku: z.string().min(1),
  reason: z.string().min(1),
})

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'owner', 'warehouse'])

  const { vin, partSku, reason } = await parseBody(event, claimSchema)

  // amount comes from the part price
  const part = await db.query.parts.findFirst({
    where: eq(schema.parts.sku, partSku),
  })
  if (!part) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่พบอะไหล่ตาม SKU ที่ระบุ' })
  }

  // next claim number: CLM-2026-NNNN
  const year = new Date().getFullYear()
  const [last] = await db
    .select({ claimNumber: schema.claims.claimNumber })
    .from(schema.claims)
    .orderBy(desc(schema.claims.id))
    .limit(1)
  const lastSeq = last ? Number(last.claimNumber.split('-').pop()) || 0 : 0
  const claimNumber = `CLM-${year}-${pad(lastSeq + 1, 4)}`

  const [claim] = await db
    .insert(schema.claims)
    .values({
      claimNumber,
      dealerId: user.dealerId ?? null, // scope the claim to the filing dealer
      vin,
      partSku,
      reason,
      status: 'submitted',
      amount: part.price,
      createdAt: new Date().toISOString(),
    })
    .returning()

  // Best-effort audit: never blocks/fails the filed claim.
  await writeAudit(user.id, 'claim.create', 'claim', claimNumber, `vin=${vin} partSku=${partSku}`)

  // Notify the filing dealer's users + admins that a claim was submitted.
  await notify({
    event: 'claim.submitted',
    entity: 'claim',
    entityId: claimNumber,
    dealerId: user.dealerId,
    toAdmins: true,
    vars: { clm: claimNumber, vin },
  })

  return { ok: true, claim }
})
