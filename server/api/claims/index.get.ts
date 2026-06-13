// GET /api/claims — Dev3 owns.
//  - default: recent claims (newest first)
//  - ?vin=XXXX: returns the purchase history (ordered parts) for that VIN so the
//    user can pick an item to file a claim against.
import { and, desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { Claim } from '../../../app/types'

export interface PurchaseHistoryItem {
  orderId: number
  poNumber: string
  partId: number
  sku: string
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  createdAt: string
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'owner', 'warehouse'])

  // owner is scoped to their own dealer; admin/warehouse see the whole network.
  const scoped = user.role === 'owner' && user.dealerId != null
  const dealerId = user.dealerId as number

  const vin = (getQuery(event).vin as string | undefined)?.trim()

  // ---- purchase history for a VIN ------------------------------------------
  if (vin) {
    // Scope the VIN's purchase history to the owner's own orders so a dealer
    // can't enumerate another dealer's buys by guessing VINs.
    const vinWhere = scoped
      ? and(eq(schema.orders.vin, vin), eq(schema.orders.dealerId, dealerId))
      : eq(schema.orders.vin, vin)
    const rows = await db
      .select({
        orderId: schema.orders.id,
        poNumber: schema.orders.poNumber,
        createdAt: schema.orders.createdAt,
        partId: schema.parts.id,
        sku: schema.parts.sku,
        name: schema.parts.name,
        qty: schema.orderItems.qty,
        unitPrice: schema.orderItems.unitPrice,
      })
      .from(schema.orders)
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .innerJoin(schema.parts, eq(schema.parts.id, schema.orderItems.partId))
      .where(vinWhere)
      .orderBy(desc(schema.orders.createdAt))

    const history: PurchaseHistoryItem[] = rows.map((r) => ({
      orderId: r.orderId,
      poNumber: r.poNumber,
      partId: r.partId,
      sku: r.sku,
      name: r.name,
      qty: r.qty,
      unitPrice: r.unitPrice,
      lineTotal: r.qty * r.unitPrice,
      createdAt: r.createdAt,
    }))

    return { vin, history }
  }

  // ---- recent claims --------------------------------------------------------
  const claims = (await db
    .select()
    .from(schema.claims)
    .where(scoped ? eq(schema.claims.dealerId, dealerId) : undefined)
    .orderBy(desc(schema.claims.createdAt))) as Claim[]

  // attach the part name for display (claims store partSku only)
  const partRows = await db
    .select({ sku: schema.parts.sku, name: schema.parts.name })
    .from(schema.parts)
  const nameBySku = new Map(partRows.map((p) => [p.sku, p.name]))

  const enriched = claims.map((c) => ({ ...c, partName: nameBySku.get(c.partSku) ?? c.partSku }))

  return { claims: enriched }
})
