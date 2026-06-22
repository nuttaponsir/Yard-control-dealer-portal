// POST /api/stock-ops/transfers — Phase 5 (Stock-ops). Request a warehouse
// transfer. Warehouse-level (admin/warehouse). The transfer is created in the
// 'requested' state and moves NO stock — inventory only shifts when the
// transfer is completed (see [id]/complete.post.ts). We still validate that the
// source warehouse currently holds enough so impossible requests are rejected
// up front (409).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'

const createTransferSchema = z
  .object({
    partId: z.number().int().positive(),
    fromWarehouse: z.string().min(1),
    toWarehouse: z.string().min(1),
    qty: z.number().int().positive(),
    note: z.string().nullish(),
  })
  .refine((b) => b.fromWarehouse !== b.toWarehouse, {
    message: 'คลังต้นทางและปลายทางต้องไม่เหมือนกัน',
    path: ['toWarehouse'],
  })

function transferNumber(seq: number): string {
  return `TRF-2026-${String(seq).padStart(6, '0')}`
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const body = await parseBody(event, createTransferSchema)

  // Part must exist.
  const part = await db.query.parts.findFirst({
    where: eq(schema.parts.id, body.partId),
  })
  if (!part) {
    throw createError({ statusCode: 400, statusMessage: `ไม่พบอะไหล่รหัส ${body.partId}` })
  }

  // Source warehouse must currently hold enough on-hand.
  const srcInv = await db.query.inventory.findFirst({
    where: and(
      eq(schema.inventory.partId, body.partId),
      eq(schema.inventory.warehouse, body.fromWarehouse),
    ),
  })
  const have = srcInv?.qtyOnHand ?? 0
  if (have < body.qty) {
    throw createError({
      statusCode: 409,
      statusMessage: `สต็อกในคลังต้นทางไม่พอ: มี ${have} ต้องการ ${body.qty}`,
    })
  }

  // Unique sequence number (scan existing, max+1).
  const existing = await db.query.stockTransfers.findMany()
  const maxSeq = existing.reduce((max, tr) => {
    const m = /^TRF-\d{4}-(\d{6})$/.exec(tr.transferNo)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  const transferNo = transferNumber(maxSeq + 1)

  const [transfer] = await db
    .insert(schema.stockTransfers)
    .values({
      transferNo,
      partId: body.partId,
      fromWarehouse: body.fromWarehouse,
      toWarehouse: body.toWarehouse,
      qty: body.qty,
      status: 'requested',
      note: body.note ?? null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      completedAt: null,
    })
    .returning()

  await writeAudit(
    user.id,
    'transfer.create',
    'stockTransfer',
    transferNo,
    `${body.fromWarehouse}→${body.toWarehouse} partId=${body.partId} qty=${body.qty}`,
  )

  return { ok: true, transfer }
})
