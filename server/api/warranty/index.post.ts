// POST /api/warranty — Phase 5. Register a part warranty against a VIN.
// Generates a WAR-2026-###### number, status 'active', computes expiresAt from
// startDate + months. Dealer-scoped: owner/sales register for their own dealer;
// admin may pass dealerId (or leave null).
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import type { Warranty } from '../../../app/types'

const warrantySchema = z.object({
  vin: z.string().length(17),
  partSku: z.string().min(1),
  startDate: z.string().min(10), // YYYY-MM-DD
  months: z.number().int().positive(),
  dealerId: z.number().int().positive().optional(), // admin only
  note: z.string().nullish(),
})

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'owner', 'sales'])

  const { vin, partSku, startDate, months, dealerId: bodyDealerId, note } = await parseBody(
    event,
    warrantySchema,
  )

  // Resolve the owning dealer. owner/sales must have a dealer; admin may pass one.
  let dealerId: number | null
  if (user.role === 'owner' || user.role === 'sales') {
    if (user.dealerId == null) {
      throw createError({ statusCode: 403, statusMessage: 'บัญชีนี้ไม่ผูกกับดีลเลอร์' })
    }
    dealerId = user.dealerId
  } else {
    dealerId = bodyDealerId ?? null
  }

  // The VIN must exist in the registry.
  const vinRow = await db.query.vins.findFirst({ where: eq(schema.vins.vin, vin) })
  if (!vinRow) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่พบ VIN ที่ระบุ' })
  }

  // The part must exist.
  const part = await db.query.parts.findFirst({ where: eq(schema.parts.sku, partSku) })
  if (!part) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่พบอะไหล่ตาม SKU ที่ระบุ' })
  }

  // Compute expiry = startDate + months (ISO date, YYYY-MM-DD).
  const d = new Date(startDate)
  d.setMonth(d.getMonth() + months)
  const expiresAt = d.toISOString().slice(0, 10)

  // next warranty number: WAR-2026-######
  const year = new Date().getFullYear()
  const [last] = await db
    .select({ warrantyNo: schema.warranties.warrantyNo })
    .from(schema.warranties)
    .orderBy(desc(schema.warranties.id))
    .limit(1)
  const lastSeq = last ? Number(last.warrantyNo.split('-').pop()) || 0 : 0
  const warrantyNo = `WAR-${year}-${pad(lastSeq + 1, 6)}`

  const [warranty] = await db
    .insert(schema.warranties)
    .values({
      warrantyNo,
      vin,
      partSku,
      dealerId,
      startDate,
      months,
      expiresAt,
      status: 'active',
      note: note ?? null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    })
    .returning()

  await writeAudit(user.id, 'warranty.create', 'warranty', warrantyNo, `vin=${vin}`)

  return { ok: true, warranty: warranty as Warranty }
})
