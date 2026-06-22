// POST /api/stock-ops/counts — Phase 5 (Stock-ops). Open a cycle count.
// Warehouse-level (admin/warehouse). Records a physical stock-take figure for a
// (part, warehouse) against the current system on-hand. NO inventory is touched
// here — the variance is only applied when the count is posted (see
// [id]/post.post.ts). systemQty is snapshotted at open time.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'

const createCountSchema = z.object({
  partId: z.number().int().positive(),
  warehouse: z.string().min(1),
  countedQty: z.number().int().min(0),
  note: z.string().nullish(),
})

function countNumber(seq: number): string {
  return `CNT-2026-${String(seq).padStart(6, '0')}`
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const body = await parseBody(event, createCountSchema)

  // Part must exist.
  const part = await db.query.parts.findFirst({
    where: eq(schema.parts.id, body.partId),
  })
  if (!part) {
    throw createError({ statusCode: 400, statusMessage: `ไม่พบอะไหล่รหัส ${body.partId}` })
  }

  // System on-hand at count time (0 if no inventory row exists yet).
  const inv = await db.query.inventory.findFirst({
    where: and(
      eq(schema.inventory.partId, body.partId),
      eq(schema.inventory.warehouse, body.warehouse),
    ),
  })
  const systemQty = inv?.qtyOnHand ?? 0
  const variance = body.countedQty - systemQty

  // Unique sequence number (scan existing, max+1).
  const existing = await db.query.cycleCounts.findMany()
  const maxSeq = existing.reduce((max, c) => {
    const m = /^CNT-\d{4}-(\d{6})$/.exec(c.countNo)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  const countNo = countNumber(maxSeq + 1)

  const [count] = await db
    .insert(schema.cycleCounts)
    .values({
      countNo,
      partId: body.partId,
      warehouse: body.warehouse,
      systemQty,
      countedQty: body.countedQty,
      variance,
      status: 'open',
      note: body.note ?? null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      postedAt: null,
    })
    .returning()

  await writeAudit(
    user.id,
    'count.create',
    'cycleCount',
    countNo,
    `${body.warehouse} partId=${body.partId} system=${systemQty} counted=${body.countedQty} variance=${variance}`,
  )

  return { ok: true, count }
})
