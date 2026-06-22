// POST /api/stock-ops/transfers/:id/complete — Phase 5 (Stock-ops). Complete a
// requested warehouse transfer. Warehouse-level (admin/warehouse). This is where
// stock actually moves: it decrements the source warehouse, increments (creating
// if needed) the destination warehouse, and posts a matching pair of ledger rows
// (issue at source, receipt at destination) — all inside one transaction so
// on-hand and the ledger never drift.
import { and, eq, sql } from 'drizzle-orm'
import { db, schema } from '../../../../db'
import { requireUser } from '../../../../utils/auth'
import { writeAudit } from '../../../../utils/audit'
import { postMovement } from '../../../../utils/wms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const idRaw = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(idRaw) || idRaw <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสใบโอนไม่ถูกต้อง' })
  }

  const transfer = await db.query.stockTransfers.findFirst({
    where: eq(schema.stockTransfers.id, idRaw),
  })
  if (!transfer) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบใบโอน' })
  }
  if (transfer.status !== 'requested') {
    throw createError({ statusCode: 409, statusMessage: 'ใบโอนนี้ดำเนินการไปแล้ว' })
  }

  // Re-check source stock at completion time (may have changed since request).
  const srcInv = await db.query.inventory.findFirst({
    where: and(
      eq(schema.inventory.partId, transfer.partId),
      eq(schema.inventory.warehouse, transfer.fromWarehouse),
    ),
  })
  const have = srcInv?.qtyOnHand ?? 0
  if (have < transfer.qty) {
    throw createError({
      statusCode: 409,
      statusMessage: `สต็อกในคลังต้นทางไม่พอ: มี ${have} ต้องการ ${transfer.qty}`,
    })
  }

  const completed = await db.transaction(async (tx) => {
    // ---- source: decrement on-hand + post the issue ledger row -------------
    await tx
      .update(schema.inventory)
      .set({ qtyOnHand: sql`${schema.inventory.qtyOnHand} - ${transfer.qty}` })
      .where(eq(schema.inventory.id, srcInv!.id))

    await postMovement(tx, {
      partId: transfer.partId,
      warehouse: transfer.fromWarehouse,
      kind: 'issue',
      qty: -transfer.qty,
      refType: 'transfer',
      refId: transfer.transferNo,
      createdBy: user.id,
    })

    // ---- destination: find/create the inventory row, then increment --------
    const dstInv = await tx.query.inventory.findFirst({
      where: and(
        eq(schema.inventory.partId, transfer.partId),
        eq(schema.inventory.warehouse, transfer.toWarehouse),
      ),
    })
    if (dstInv) {
      await tx
        .update(schema.inventory)
        .set({ qtyOnHand: sql`${schema.inventory.qtyOnHand} + ${transfer.qty}` })
        .where(eq(schema.inventory.id, dstInv.id))
    } else {
      await tx.insert(schema.inventory).values({
        partId: transfer.partId,
        warehouse: transfer.toWarehouse,
        qtyOnHand: transfer.qty,
        reorderPoint: 0,
      })
    }

    await postMovement(tx, {
      partId: transfer.partId,
      warehouse: transfer.toWarehouse,
      kind: 'receipt',
      qty: transfer.qty,
      refType: 'transfer',
      refId: transfer.transferNo,
      createdBy: user.id,
    })

    // ---- mark the transfer completed ---------------------------------------
    const [row] = await tx
      .update(schema.stockTransfers)
      .set({ status: 'completed', completedAt: new Date().toISOString() })
      .where(eq(schema.stockTransfers.id, transfer.id))
      .returning()
    return row!
  })

  await writeAudit(
    user.id,
    'transfer.complete',
    'stockTransfer',
    transfer.transferNo,
    `${transfer.fromWarehouse}→${transfer.toWarehouse} partId=${transfer.partId} qty=${transfer.qty}`,
  )

  return { ok: true, transfer: completed }
})
