// GET /api/procurement/reorder?warehouse=<wh> — reorder suggestions for the PO
// form (#6). Lists parts below their reorder point in the given warehouse with a
// suggested top-up qty (to 2× reorder) and the part price as a cost proxy.
// admin + warehouse. Static path wins over the [id] param route in Nitro.
import { and, eq, lt } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])
  const wh = getQuery(event).warehouse
  const warehouse = typeof wh === 'string' && wh.trim() ? wh.trim() : null

  const where = warehouse
    ? and(lt(schema.inventory.qtyOnHand, schema.inventory.reorderPoint), eq(schema.inventory.warehouse, warehouse))
    : lt(schema.inventory.qtyOnHand, schema.inventory.reorderPoint)

  const rows = await db
    .select({
      partId: schema.parts.id,
      sku: schema.parts.sku,
      name: schema.parts.name,
      price: schema.parts.price,
      warehouse: schema.inventory.warehouse,
      qtyOnHand: schema.inventory.qtyOnHand,
      reorderPoint: schema.inventory.reorderPoint,
    })
    .from(schema.inventory)
    .innerJoin(schema.parts, eq(schema.inventory.partId, schema.parts.id))
    .where(where)

  const items = rows.map((r) => ({
    partId: r.partId,
    sku: r.sku,
    name: r.name,
    warehouse: r.warehouse,
    qtyOnHand: r.qtyOnHand,
    reorderPoint: r.reorderPoint,
    suggestedQty: Math.max(1, r.reorderPoint * 2 - r.qtyOnHand),
    unitCost: r.price,
  }))

  return { items }
})
