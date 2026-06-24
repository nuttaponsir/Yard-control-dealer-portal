// PATCH /api/claims/[id] — Phase M. admin/warehouse decide a claim: set its
// status and/or resolution (a claim_resolutions.code). Deciding stamps
// decidedBy/decidedAt. When the chosen resolution is refundable and the claim
// is bound to an order (and has no RMA yet), an RMA is auto-created against the
// order's matching line — left 'requested' so the existing returns approval
// workflow handles restock/credit. No stock/credit moves here.
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import { computeOrderMoney } from '../../utils/pricing'

const patchSchema = z
  .object({
    status: z.enum(['submitted', 'reviewing', 'rejected', 'approved']).optional(),
    resolution: z.string().min(1).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.resolution !== undefined, {
    message: 'ต้องระบุ status หรือ resolution อย่างน้อยหนึ่งอย่าง',
  })

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสเคลมไม่ถูกต้อง' })
  }

  const body = await parseBody(event, patchSchema)

  const claim = await db.query.claims.findFirst({ where: eq(schema.claims.id, id) })
  if (!claim) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบเคลม' })
  }

  // Validate the resolution (if a non-null one is being set) against the master.
  let resolutionRow: typeof schema.claimResolutions.$inferSelect | undefined
  const settingResolution = body.resolution !== undefined
  if (body.resolution != null) {
    resolutionRow = await db.query.claimResolutions.findFirst({
      where: eq(schema.claimResolutions.code, body.resolution),
    })
    if (!resolutionRow) {
      throw createError({ statusCode: 400, statusMessage: 'ไม่พบวิธีปิดเคลมตามรหัสที่ระบุ' })
    }
  }

  const patch: Partial<typeof schema.claims.$inferInsert> = {}
  if (body.status !== undefined) patch.status = body.status
  if (settingResolution) patch.resolution = body.resolution

  // Stamp the decision when the claim is closed (approved/rejected) or a
  // resolution is recorded.
  const decided =
    body.status === 'approved' || body.status === 'rejected' || (settingResolution && body.resolution != null)
  if (decided) {
    patch.decidedBy = user.id
    patch.decidedAt = new Date().toISOString()
  }

  // ---- Refund auto-RMA -----------------------------------------------------
  // If the resolution being set is refundable AND the claim is bound to an order
  // AND no RMA exists yet, create a 'requested' return against the matching
  // order line. Resolution failures are non-fatal: we still save the decision
  // and surface a note.
  let createdReturn: typeof schema.returns.$inferSelect | null = null
  let note: string | undefined
  const shouldRefund =
    resolutionRow?.refundable === true && claim.orderId != null && claim.returnId == null

  if (shouldRefund) {
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, claim.orderId as number),
    })
    const part = await db.query.parts.findFirst({
      where: eq(schema.parts.sku, claim.partSku),
    })

    if (!order || !part) {
      note = 'ไม่สามารถสร้าง RMA อัตโนมัติ: ไม่พบออเดอร์หรืออะไหล่ที่เกี่ยวข้อง'
    } else {
      // Find the order line for the claimed part.
      const line = await db.query.orderItems.findFirst({
        where: and(
          eq(schema.orderItems.orderId, order.id),
          eq(schema.orderItems.partId, part.id),
        ),
      })
      if (!line) {
        note = 'ไม่สามารถสร้าง RMA อัตโนมัติ: อะไหล่ที่เคลมไม่อยู่ในออเดอร์'
      } else {
        // Refund computation — reproduce the order's effective discount % and
        // VAT % so a single-unit refund ties back proportionally (matches
        // returns/index.post.ts).
        const net = order.subtotal - order.discount
        const discountPct = order.subtotal > 0 ? (order.discount / order.subtotal) * 100 : 0
        const vatRate = net > 0 ? (order.vat / net) * 100 : 0
        const money = computeOrderMoney([{ unitPrice: line.unitPrice, qty: 1 }], discountPct, vatRate)
        const refundAmount = Math.min(money.total, order.totalValue)

        // Next RMA number: RMA-YYYY-NNNN
        const year = new Date().getFullYear()
        const [lastRma] = await db
          .select({ rmaNumber: schema.returns.rmaNumber })
          .from(schema.returns)
          .orderBy(desc(schema.returns.id))
          .limit(1)
        const lastSeq = lastRma ? Number(lastRma.rmaNumber.split('-').pop()) || 0 : 0
        const rmaNumber = `RMA-${year}-${pad(lastSeq + 1, 4)}`

        createdReturn = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(schema.returns)
            .values({
              rmaNumber,
              orderId: order.id,
              dealerId: order.dealerId,
              reason: claim.reason,
              status: 'requested',
              refundAmount,
              decidedBy: null,
              decidedAt: null,
              createdAt: new Date().toISOString(),
            })
            .returning()

          await tx.insert(schema.returnItems).values({
            returnId: row!.id,
            partId: part.id,
            qty: 1,
            unitPrice: line.unitPrice,
          })
          return row!
        })

        patch.returnId = createdReturn.id
      }
    }
  }

  const [updated] = await db
    .update(schema.claims)
    .set(patch)
    .where(eq(schema.claims.id, id))
    .returning()

  // Best-effort audit: never blocks/fails the decision.
  await writeAudit(
    user.id,
    'claim.decide',
    'claim',
    claim.claimNumber,
    `status=${updated!.status} resolution=${updated!.resolution ?? '-'}${
      createdReturn ? ` rma=${createdReturn.rmaNumber}` : ''
    }`,
  )

  return { ok: true, claim: updated, return: createdReturn, ...(note ? { note } : {}) }
})
