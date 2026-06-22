// POST /api/procurement — Phase 5 (Procurement). Create a purchase order to a
// supplier. Warehouse-level access (admin/warehouse), NOT dealer-scoped.
//   • body is validated with Zod (parseBody → typed 400)
//   • the supplier and every referenced part must exist (else 400)
//   • totalCost is computed server-side from qtyOrdered × unitCost
//   • a fresh PO-IN-2026-###### number is issued by scanning existing rows
//   • the PO header + its items are inserted inside one transaction
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import type { PurchaseOrder } from '../../../app/types'

const createPoSchema = z.object({
  supplierId: z.number().int().positive(),
  warehouse: z.string().min(1),
  note: z.string().nullish(),
  expectedAt: z.string().nullish(),
  items: z
    .array(
      z.object({
        partId: z.number().int().positive(),
        qtyOrdered: z.number().int().positive(),
        unitCost: z.number().int().min(0),
      }),
    )
    .min(1),
})

function poNumber(seq: number): string {
  return `PO-IN-2026-${String(seq).padStart(6, '0')}`
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const body = await parseBody(event, createPoSchema)

  // Supplier must exist.
  const supplier = await db.query.suppliers.findFirst({
    where: eq(schema.suppliers.id, body.supplierId),
  })
  if (!supplier) {
    throw createError({ statusCode: 400, statusMessage: `ไม่พบซัพพลายเออร์รหัส ${body.supplierId}` })
  }

  // Every referenced part must exist.
  const partIds = [...new Set(body.items.map((i) => i.partId))]
  const partRows = await db.query.parts.findMany({
    where: inArray(schema.parts.id, partIds),
  })
  const partIdSet = new Set(partRows.map((p) => p.id))
  for (const it of body.items) {
    if (!partIdSet.has(it.partId)) {
      throw createError({ statusCode: 400, statusMessage: `ไม่พบอะไหล่รหัส ${it.partId}` })
    }
  }

  const totalCost = body.items.reduce((sum, it) => sum + it.qtyOrdered * it.unitCost, 0)

  // Issue the next PO number (scan existing PO-IN-2026-###### rows).
  const existing = await db.query.purchaseOrders.findMany()
  const maxSeq = existing.reduce((max, p) => {
    const m = /^PO-IN-2026-(\d{6})$/.exec(p.poNumber)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  const newPo = poNumber(maxSeq + 1)

  const now = new Date().toISOString()

  const purchaseOrder = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.purchaseOrders)
      .values({
        poNumber: newPo,
        supplierId: body.supplierId,
        warehouse: body.warehouse,
        status: 'ordered',
        totalCost,
        note: body.note ?? null,
        expectedAt: body.expectedAt ?? null,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await tx.insert(schema.purchaseOrderItems).values(
      body.items.map((it) => ({
        purchaseOrderId: created!.id,
        partId: it.partId,
        qtyOrdered: it.qtyOrdered,
        qtyReceived: 0,
        unitCost: it.unitCost,
      })),
    )

    return created!
  })

  await writeAudit(
    user.id,
    'purchase.create',
    'purchase_order',
    newPo,
    `supplierId=${body.supplierId} warehouse=${body.warehouse} items=${body.items.length} total=${totalCost}`,
  )

  return { ok: true, purchaseOrder: purchaseOrder as PurchaseOrder }
})
