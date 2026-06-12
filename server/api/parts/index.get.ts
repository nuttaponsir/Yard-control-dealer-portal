// GET /api/parts — Dev2 owns. Parts catalog list joined with per-warehouse
// inventory. Optional ?category= filter. Optional ?vin= / ?model= filter that
// returns only parts compatible with the vehicle's model (universal parts —
// empty compatibleModels — always included). Protected (any authenticated user).
import { eq, or, sql } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { readPagination, paginate } from '../../utils/pagination'
import type { Part, Warehouse } from '../../../app/types'

export interface CatalogPart extends Part {
  stock: { warehouse: Warehouse; qtyOnHand: number; reorderPoint: number }[]
}

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const query = getQuery(event)
  const category = typeof query.category === 'string' ? query.category : undefined
  const vinParam = typeof query.vin === 'string' ? query.vin.trim().toUpperCase() : undefined
  const modelParam = typeof query.model === 'string' ? query.model : undefined

  // Resolve the target model: explicit ?model= wins, else look up the VIN's model.
  let model = modelParam
  if (!model && vinParam) {
    const vinRow = await db.query.vins.findFirst({
      where: eq(schema.vins.vin, vinParam),
    })
    model = vinRow?.model
  }

  // Array-membership filter: keep universal parts (empty array) OR parts whose
  // compatible_models contains the model. `= ANY(...)` reads the text[] column.
  const partRows = model
    ? await db
        .select()
        .from(schema.parts)
        .where(
          or(
            sql`cardinality(${schema.parts.compatibleModels}) = 0`,
            sql`${model} = ANY(${schema.parts.compatibleModels})`,
          ),
        )
    : await db.query.parts.findMany()
  const invRows = await db.query.inventory.findMany()

  const invByPart = new Map<number, CatalogPart['stock']>()
  for (const inv of invRows) {
    const list = invByPart.get(inv.partId) ?? []
    list.push({
      warehouse: inv.warehouse as Warehouse,
      qtyOnHand: inv.qtyOnHand,
      reorderPoint: inv.reorderPoint,
    })
    invByPart.set(inv.partId, list)
  }

  let parts: CatalogPart[] = partRows.map((p) => ({
    ...(p as Part),
    stock: invByPart.get(p.id) ?? [],
  }))

  if (category && category !== 'ทั้งหมด') {
    parts = parts.filter((p) => p.category === category)
  }

  // Opt-in pagination over the category/VIN-filtered catalog (legacy shape kept).
  const pagination = readPagination(event)
  if (pagination) {
    const { items, meta } = paginate(parts, pagination)
    return { parts: items, meta }
  }

  return { parts }
})
