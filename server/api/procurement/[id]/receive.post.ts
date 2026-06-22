// POST /api/procurement/:id/receive — Phase 5 (Procurement). Receive goods
// against a purchase order. Warehouse-level access (admin/warehouse).
//   • optional body { lines: [{ itemId, qty }] } receives those specific items;
//     omit it (or omit lines) to receive ALL remaining quantity on every line.
//   • each receipt: bump inventory.qtyOnHand for (partId, PO.warehouse) — create
//     the inventory row if missing — bump item.qtyReceived, and post a 'receipt'
//     movement to the ledger (refType 'purchase', refId PO.poNumber).
//   • PO status is recomputed: all lines full → 'received', any received → 'partial'.
//   • everything happens inside one transaction (on-hand, items, ledger atomic).
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'
import { postMovement } from '../../../utils/wms'
import type { PurchaseOrder } from '../../../../app/types'

const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        qty: z.number().int().positive(),
      }),
    )
    .optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสใบสั่งซื้อไม่ถูกต้อง' })
  }

  const body = await parseBody(event, receiveSchema)

  const po = await db.query.purchaseOrders.findFirst({
    where: eq(schema.purchaseOrders.id, id),
  })
  if (!po) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบใบสั่งซื้อ' })
  }
  if (po.status === 'received' || po.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'ใบสั่งซื้อนี้รับครบหรือถูกยกเลิกแล้ว' })
  }

  const items = await db.query.purchaseOrderItems.findMany({
    where: eq(schema.purchaseOrderItems.purchaseOrderId, id),
  })
  const itemById = new Map(items.map((it) => [it.id, it]))

  // Determine the receipts: explicit lines, or "receive all remaining".
  type Receipt = { itemId: number; qty: number }
  let receipts: Receipt[]
  if (body.lines && body.lines.length) {
    receipts = []
    for (const line of body.lines) {
      const it = itemById.get(line.itemId)
      if (!it) {
        throw createError({ statusCode: 400, statusMessage: `ไม่พบรายการรหัส ${line.itemId} ในใบสั่งซื้อนี้` })
      }
      const remaining = it.qtyOrdered - it.qtyReceived
      if (line.qty > remaining) {
        throw createError({
          statusCode: 400,
          statusMessage: `รับเกินจำนวนคงเหลือ (เหลือ ${remaining}) สำหรับรายการ ${line.itemId}`,
        })
      }
      receipts.push({ itemId: line.itemId, qty: line.qty })
    }
  } else {
    receipts = items
      .map((it) => ({ itemId: it.id, qty: it.qtyOrdered - it.qtyReceived }))
      .filter((r) => r.qty > 0)
  }

  if (!receipts.length) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่มีจำนวนที่ต้องรับเข้า' })
  }

  const now = new Date().toISOString()

  const purchaseOrder = await db.transaction(async (tx) => {
    for (const r of receipts) {
      const it = itemById.get(r.itemId)!

      // Inventory row for (partId, destination warehouse) — create if absent.
      const inv = await tx.query.inventory.findFirst({
        where: and(
          eq(schema.inventory.partId, it.partId),
          eq(schema.inventory.warehouse, po.warehouse),
        ),
      })
      if (inv) {
        await tx
          .update(schema.inventory)
          .set({ qtyOnHand: inv.qtyOnHand + r.qty })
          .where(eq(schema.inventory.id, inv.id))
      } else {
        await tx.insert(schema.inventory).values({
          partId: it.partId,
          warehouse: po.warehouse,
          qtyOnHand: r.qty,
          reorderPoint: 0,
        })
      }

      // Advance the received quantity on the PO line.
      await tx
        .update(schema.purchaseOrderItems)
        .set({ qtyReceived: it.qtyReceived + r.qty })
        .where(eq(schema.purchaseOrderItems.id, it.id))

      // Ledger: record the receipt against the destination warehouse.
      await postMovement(tx, {
        partId: it.partId,
        warehouse: po.warehouse,
        kind: 'receipt',
        qty: r.qty,
        refType: 'purchase',
        refId: po.poNumber,
        createdBy: user.id,
      })
    }

    // Recompute status from the post-receipt received quantities.
    const receivedById = new Map(receipts.map((r) => [r.itemId, r.qty]))
    let allFull = true
    let anyReceived = false
    for (const it of items) {
      const nowReceived = it.qtyReceived + (receivedById.get(it.id) ?? 0)
      if (nowReceived < it.qtyOrdered) allFull = false
      if (nowReceived > 0) anyReceived = true
    }
    const status = allFull ? 'received' : anyReceived ? 'partial' : po.status

    const [updated] = await tx
      .update(schema.purchaseOrders)
      .set({ status, updatedAt: now })
      .where(eq(schema.purchaseOrders.id, id))
      .returning()

    return updated!
  })

  await writeAudit(
    user.id,
    'purchase.receive',
    'purchase_order',
    po.poNumber,
    `lines=${receipts.length} qty=${receipts.reduce((s, r) => s + r.qty, 0)} status=${purchaseOrder.status}`,
  )

  return { ok: true, purchaseOrder: purchaseOrder as PurchaseOrder }
})
