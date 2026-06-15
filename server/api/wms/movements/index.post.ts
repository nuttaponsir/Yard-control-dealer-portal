// POST /api/wms/movements — Phase 3 (WMS). Post a MANUAL stock adjustment.
// Warehouse-level (admin/warehouse), NOT dealer-scoped. A signed qty is applied
// to inventory.qtyOnHand for (partId, warehouse) and a matching ledger row is
// appended — both inside one transaction so on-hand and the ledger never drift.
//   • qty > 0 adds on-hand; qty < 0 removes it; qty === 0 is rejected.
//   • the (partId, warehouse) inventory row must already exist.
//   • on-hand may never go negative.
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'
import { postMovement } from '../../../utils/wms'

const adjustSchema = z.object({
  partId: z.number().int().positive(),
  warehouse: z.string().min(1),
  qty: z.number().int().refine((n) => n !== 0, { message: 'qty must not be zero' }),
  note: z.string().nullish(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const body = await parseBody(event, adjustSchema)

  const movement = await db.transaction(async (tx) => {
    const inv = await tx.query.inventory.findFirst({
      where: and(
        eq(schema.inventory.partId, body.partId),
        eq(schema.inventory.warehouse, body.warehouse),
      ),
    })
    if (!inv) {
      throw createError({ statusCode: 400, statusMessage: 'ไม่พบสต็อกของอะไหล่นี้ในคลังที่ระบุ' })
    }

    const newQty = inv.qtyOnHand + body.qty
    if (newQty < 0) {
      throw createError({ statusCode: 409, statusMessage: 'สต็อกไม่พอสำหรับการปรับลด' })
    }

    await tx
      .update(schema.inventory)
      .set({ qtyOnHand: newQty })
      .where(eq(schema.inventory.id, inv.id))

    return await postMovement(tx, {
      partId: body.partId,
      warehouse: body.warehouse,
      kind: 'adjust',
      qty: body.qty,
      refType: 'manual',
      note: body.note ?? null,
      createdBy: user.id,
    })
  })

  await writeAudit(user.id, 'stock.adjust', 'part', String(body.partId), `${body.warehouse} qty=${body.qty}`)

  return { ok: true, movement }
})
