// GET /api/parts/export — Dev2 owns. Download the parts catalog as .xlsx. Open
// to any authenticated user (mirrors /api/parts). The nested per-warehouse stock
// array is flattened into a single derived totalStock column (sum of qtyOnHand);
// one row per part.
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { Part } from '../../../app/types'

export default defineEventHandler(async (event) => {
  await requireUser(event)

  const partRows = await db.query.parts.findMany()
  const invRows = await db.query.inventory.findMany()

  const totalStock = new Map<number, number>()
  for (const inv of invRows) {
    totalStock.set(inv.partId, (totalStock.get(inv.partId) ?? 0) + inv.qtyOnHand)
  }

  const parts = (partRows as Part[]).sort((a, b) => a.sku.localeCompare(b.sku))

  const rows = parts.map((p) => ({
    sku: p.sku,
    name: p.name,
    category: p.category,
    oem: p.oem,
    price: p.price,
    warrantyMonths: p.warrantyMonths,
    leadTimeDays: p.leadTimeDays,
    compatibleModels: p.compatibleModels.join(', '),
    totalStock: totalStock.get(p.id) ?? 0,
  }))

  const columns: XlsxColumn[] = [
    { key: 'sku' },
    { key: 'name' },
    { key: 'category' },
    { key: 'oem' },
    { key: 'price' },
    { key: 'warrantyMonths' },
    { key: 'leadTimeDays' },
    { key: 'compatibleModels' },
    { key: 'totalStock' },
  ]

  const buf = await buildXlsx(columns, rows, 'catalog')
  return sendXlsx(event, buf, `catalog-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
