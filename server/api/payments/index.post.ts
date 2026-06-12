// POST /api/payments — Phase G (Accounts Receivable). Record money received
// from a dealer and RELEASE the matching credit. This is the missing half of
// the credit lifecycle: orders consume credit on create; cancels/returns
// release it on goods movement; payments release it on settlement.
//
// Business rules (all enforced inside one DB transaction):
//   • RBAC          — admin posts for any dealer; owner posts only for its own.
//   • amount > 0    — integer THB.
//   • order match   — when orderId is given it must belong to the same dealer,
//                     and amount may not exceed that order's outstanding balance.
//   • order paid    — order.amountPaid += amount; paymentStatus recomputed.
//   • credit release— dealer.creditUsed = max(0, creditUsed − amount).
//   • atomicity     — payment row + order paid + credit move together or not at all.
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import type { PaymentStatus } from '../../../app/types'

const createPaymentSchema = z.object({
  dealerId: z.number().int().positive(),
  orderId: z.number().int().positive().nullable().optional(),
  amount: z.number().int().positive(),
  method: z.enum(['transfer', 'cash', 'cheque', 'card']),
  reference: z.string().max(120).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  receivedAt: z.string().min(1).optional(),
})

function receiptNumber(seq: number): string {
  return `RCP-2026-${String(seq).padStart(6, '0')}`
}

/** Derive payment status from paid-vs-total. */
function deriveStatus(amountPaid: number, totalValue: number): PaymentStatus {
  if (amountPaid <= 0) return 'unpaid'
  if (amountPaid >= totalValue) return 'paid'
  return 'partial'
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'owner'])

  const body = await parseBody(event, createPaymentSchema)

  // Dealer scoping: an owner may only post payments for its own dealer.
  if (user.role === 'owner') {
    if (user.dealerId == null) {
      throw createError({ statusCode: 403, statusMessage: 'บัญชีนี้ไม่ได้ผูกกับดีลเลอร์' })
    }
    if (body.dealerId !== user.dealerId) {
      throw createError({ statusCode: 403, statusMessage: 'ไม่มีสิทธิ์บันทึกการชำระเงินของดีลเลอร์อื่น' })
    }
  }

  const dealer = await db.query.dealers.findFirst({
    where: eq(schema.dealers.id, body.dealerId),
  })
  if (!dealer) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบข้อมูลดีลเลอร์' })
  }

  // When applied to a specific order, validate ownership + outstanding balance.
  let order: typeof schema.orders.$inferSelect | undefined
  if (body.orderId != null) {
    order = await db.query.orders.findFirst({ where: eq(schema.orders.id, body.orderId) })
    if (!order) {
      throw createError({ statusCode: 404, statusMessage: 'ไม่พบคำสั่งซื้อ' })
    }
    if (order.dealerId !== body.dealerId) {
      throw createError({ statusCode: 409, statusMessage: 'คำสั่งซื้อนี้ไม่ได้เป็นของดีลเลอร์ที่ระบุ' })
    }
    const outstanding = order.totalValue - order.amountPaid
    if (body.amount > outstanding) {
      throw createError({
        statusCode: 409,
        statusMessage: `ยอดชำระเกินยอดค้าง: ค้าง ฿${outstanding} แต่ชำระ ฿${body.amount}`,
      })
    }
  }

  // Unique receipt sequence (continue past any seeded receipts).
  const existing = await db.query.payments.findMany()
  const maxSeq = existing.reduce((max, p) => {
    const m = /^RCP-\d{4}-(\d{6})$/.exec(p.receiptNo)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  const seq = maxSeq + 1
  const newReceipt = receiptNumber(seq)
  const now = new Date().toISOString()

  // ---- transaction: record payment, mark order paid, release credit --------
  const payment = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.payments)
      .values({
        receiptNo: newReceipt,
        dealerId: body.dealerId,
        orderId: body.orderId ?? null,
        amount: body.amount,
        method: body.method,
        reference: body.reference ?? null,
        note: body.note ?? null,
        receivedAt: body.receivedAt ?? now,
        createdBy: user.id,
        createdAt: now,
      })
      .returning()

    // Apply to the order's balance + recompute its payment status.
    if (order) {
      const newPaid = order.amountPaid + body.amount
      await tx
        .update(schema.orders)
        .set({ amountPaid: newPaid, paymentStatus: deriveStatus(newPaid, order.totalValue) })
        .where(eq(schema.orders.id, order.id))
    }

    // Release the dealer's credit (never below 0).
    await tx
      .update(schema.dealers)
      .set({ creditUsed: sql`GREATEST(0, ${schema.dealers.creditUsed} - ${body.amount})` })
      .where(eq(schema.dealers.id, body.dealerId))

    return created!
  })

  await writeAudit(
    user.id,
    'payment.create',
    'payment',
    newReceipt,
    `dealerId=${body.dealerId} orderId=${body.orderId ?? '-'} amount=${body.amount} method=${body.method}`,
  )

  return { ok: true, payment, receiptNo: newReceipt }
})
