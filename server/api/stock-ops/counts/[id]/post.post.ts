// POST /api/stock-ops/counts/:id/post — Phase 5 (Stock-ops). Post an open cycle
// count. Warehouse-level (admin/warehouse). This reconciles inventory to the
// physical figure: it sets on-hand to countedQty (creating the inventory row if
// needed) and — when there's a non-zero variance — posts a single 'adjust'
// ledger row for the delta. All inside one transaction so on-hand and the ledger
// never drift.
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../../db'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { postMovement } from '../../../../utils/wms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const idRaw = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(idRaw) || idRaw <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสใบตรวจนับไม่ถูกต้อง' })
  }

  const count = await db.query.cycleCounts.findFirst({
    where: eq(schema.cycleCounts.id, idRaw),
  })
  if (!count) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบใบตรวจนับ' })
  }
  if (count.status !== 'open') {
    throw createError({ statusCode: 409, statusMessage: 'ใบตรวจนับนี้ดำเนินการไปแล้ว' })
  }

  const posted = await db.transaction(async (tx) => {
    // ---- reconcile inventory to the counted figure -------------------------
    const inv = await tx.query.inventory.findFirst({
      where: and(
        eq(schema.inventory.partId, count.partId),
        eq(schema.inventory.warehouse, count.warehouse),
      ),
    })
    if (inv) {
      await tx
        .update(schema.inventory)
        .set({ qtyOnHand: count.countedQty })
        .where(eq(schema.inventory.id, inv.id))
    } else {
      await tx.insert(schema.inventory).values({
        partId: count.partId,
        warehouse: count.warehouse,
        qtyOnHand: count.countedQty,
        reorderPoint: 0,
      })
    }

    // ---- ledger: one adjust row for the variance (skip when zero) ----------
    if (count.variance !== 0) {
      await postMovement(tx, {
        partId: count.partId,
        warehouse: count.warehouse,
        kind: 'adjust',
        qty: count.variance,
        refType: 'count',
        refId: count.countNo,
        note: 'ตรวจนับ',
        createdBy: user.id,
      })
    }

    // ---- mark the count posted ---------------------------------------------
    const [row] = await tx
      .update(schema.cycleCounts)
      .set({ status: 'posted', postedAt: new Date().toISOString() })
      .where(eq(schema.cycleCounts.id, count.id))
      .returning()
    return row!
  })

  await writeAudit(
    user.id,
    'count.post',
    'cycleCount',
    count.countNo,
    `${count.warehouse} partId=${count.partId} variance=${count.variance}`,
  )

  return { ok: true, count: posted }
})
