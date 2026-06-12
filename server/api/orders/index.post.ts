// POST /api/orders — Dev2 owns. Place an order (owner/sales only; admin is
// forbidden by requireUser). The body is validated with Zod. Prices and the
// total are computed server-side from the DB (client prices are NOT trusted).
//
// Phase C business rules (all enforced inside a single DB transaction):
//   • tiered pricing  — dealer grade → priceTiers.discountPct
//   • VAT             — appConfig.vat_rate applied to the discounted subtotal
//   • invoice number  — INV-2026-###### issued at order time
//   • credit limit    — reject when creditUsed + total > creditLimit (409)
//   • stock guard     — reject oversell; decrement inventory on success (409)
//   • atomicity       — order + items + stock + credit move together or not at all
import { z } from 'zod'
import { eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import { notify } from '../../utils/notify'
import { computeOrderMoney } from '../../utils/pricing'

const createOrderSchema = z.object({
  vin: z.string().length(17),
  items: z
    .array(
      z.object({
        partId: z.number().int().positive(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
})

function poNumber(seq: number): string {
  return `PO-2026-${String(seq).padStart(6, '0')}`
}
function invoiceNumber(seq: number): string {
  return `INV-2026-${String(seq).padStart(6, '0')}`
}

const DEFAULT_VAT_RATE = 7

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['owner', 'sales'])
  if (user.dealerId == null) {
    throw createError({ statusCode: 403, statusMessage: 'บัญชีนี้ไม่ได้ผูกกับดีลเลอร์' })
  }

  const { vin, items } = await parseBody(event, createOrderSchema)

  // VIN gate: the order must reference a known vehicle whose Autologic
  // telematics device is installed. No device → no parts ordering.
  const vinRow = await db.query.vins.findFirst({
    where: eq(schema.vins.vin, vin),
  })
  if (!vinRow) {
    throw createError({ statusCode: 400, statusMessage: `ไม่พบ VIN ${vin} ในระบบ` })
  }
  if (!vinRow.autologicInstalled) {
    throw createError({
      statusCode: 422,
      statusMessage: 'รถคันนี้ยังไม่ได้ติดตั้งอุปกรณ์ Autologic จึงสั่งซื้ออะไหล่ไม่ได้',
    })
  }

  // Collapse duplicate partIds into a single line (sum the quantities) so the
  // stock guard and pricing see the true per-part demand.
  const qtyByPart = new Map<number, number>()
  for (const it of items) qtyByPart.set(it.partId, (qtyByPart.get(it.partId) ?? 0) + it.qty)
  const lines = [...qtyByPart.entries()].map(([partId, qty]) => ({ partId, qty }))
  const partIds = lines.map((l) => l.partId)

  // Resolve prices from the DB — never trust the client.
  const partRows = await db.query.parts.findMany({
    where: inArray(schema.parts.id, partIds),
  })
  const priceById = new Map(partRows.map((p) => [p.id, p.price]))
  for (const l of lines) {
    if (!priceById.has(l.partId)) {
      throw createError({ statusCode: 400, statusMessage: `ไม่พบอะไหล่รหัส ${l.partId}` })
    }
  }

  // Dealer (for grade → discount tier + credit headroom).
  const dealer = await db.query.dealers.findFirst({
    where: eq(schema.dealers.id, user.dealerId),
  })
  if (!dealer) {
    throw createError({ statusCode: 403, statusMessage: 'ไม่พบข้อมูลดีลเลอร์' })
  }

  // Tiered discount from the price-tier master (M7); fall back to 0% if unset.
  const tier = await db.query.priceTiers.findFirst({
    where: eq(schema.priceTiers.grade, dealer.grade),
  })
  const discountPct = tier?.discountPct ?? 0

  // VAT rate from app config (M11); fall back to the statutory 7%.
  const vatCfg = await db.query.appConfig.findFirst({
    where: eq(schema.appConfig.key, 'vat_rate'),
  })
  const vatRate = vatCfg ? Number(vatCfg.value) || DEFAULT_VAT_RATE : DEFAULT_VAT_RATE

  const money = computeOrderMoney(
    lines.map((l) => ({ unitPrice: priceById.get(l.partId) as number, qty: l.qty })),
    discountPct,
    vatRate,
  )

  // Credit-limit enforcement — reject before touching any data.
  if (dealer.creditUsed + money.total > dealer.creditLimit) {
    const available = dealer.creditLimit - dealer.creditUsed
    throw createError({
      statusCode: 409,
      statusMessage: `วงเงินเครดิตไม่พอ: ต้องการ ${money.total} แต่เหลือ ${available}`,
    })
  }

  // Stock guard — total on-hand across warehouses must cover each line.
  const invRows = await db.query.inventory.findMany({
    where: inArray(schema.inventory.partId, partIds),
  })
  const onHandByPart = new Map<number, number>()
  for (const r of invRows) {
    onHandByPart.set(r.partId, (onHandByPart.get(r.partId) ?? 0) + r.qtyOnHand)
  }
  for (const l of lines) {
    const have = onHandByPart.get(l.partId) ?? 0
    if (have < l.qty) {
      throw createError({
        statusCode: 409,
        statusMessage: `สต็อกไม่พอสำหรับอะไหล่รหัส ${l.partId}: มี ${have} ต้องการ ${l.qty}`,
      })
    }
  }

  // Unique sequence number, shared by the PO and invoice (continue past seed).
  const existing = await db.query.orders.findMany()
  const maxSeq = existing.reduce((max, o) => {
    const m = /^PO-\d{4}-(\d{6})$/.exec(o.poNumber)
    return m ? Math.max(max, Number(m[1])) : max
  }, 89000)
  const seq = maxSeq + 1
  const newPo = poNumber(seq)
  const newInvoice = invoiceNumber(seq)

  // ---- transaction: persist order, decrement stock, charge credit ----------
  const order = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.orders)
      .values({
        poNumber: newPo,
        dealerId: user.dealerId!,
        vin,
        status: 'pending',
        subtotal: money.subtotal,
        discount: money.discount,
        vat: money.vat,
        totalValue: money.total,
        invoiceNo: newInvoice,
        trackingNo: null,
        carrier: null,
        createdAt: new Date().toISOString(),
      })
      .returning()

    await tx.insert(schema.orderItems).values(
      lines.map((l) => ({
        orderId: created!.id,
        partId: l.partId,
        qty: l.qty,
        unitPrice: priceById.get(l.partId) as number,
      })),
    )

    // Greedy decrement: draw from the fullest warehouse first per part.
    for (const l of lines) {
      let remaining = l.qty
      const rows = invRows
        .filter((r) => r.partId === l.partId)
        .sort((a, b) => b.qtyOnHand - a.qtyOnHand)
      for (const r of rows) {
        if (remaining <= 0) break
        const take = Math.min(r.qtyOnHand, remaining)
        if (take <= 0) continue
        await tx
          .update(schema.inventory)
          .set({ qtyOnHand: sql`${schema.inventory.qtyOnHand} - ${take}` })
          .where(eq(schema.inventory.id, r.id))
        remaining -= take
      }
    }

    // Charge the dealer's credit by the grand total.
    await tx
      .update(schema.dealers)
      .set({ creditUsed: sql`${schema.dealers.creditUsed} + ${money.total}` })
      .where(eq(schema.dealers.id, user.dealerId!))

    return created!
  })

  // Best-effort audit: never blocks/fails the created order.
  await writeAudit(
    user.id,
    'order.create',
    'order',
    newPo,
    `dealerId=${user.dealerId} subtotal=${money.subtotal} discount=${money.discount} vat=${money.vat} total=${money.total}`,
  )

  // Notify the dealer's users that the order was received (best-effort).
  await notify({
    event: 'order.created',
    entity: 'order',
    entityId: newPo,
    dealerId: user.dealerId,
    vars: { po: newPo, total: money.total },
  })

  return { ok: true, order, poNumber: newPo, invoiceNo: newInvoice, money }
})
