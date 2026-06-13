// GET /api/masters/:entity/export — download all rows of a master as .xlsx.
// Admin only. Works for every registered master (editable or read-only).
import { asc } from 'drizzle-orm'
import { db } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { getMaster, masterColumns } from '../registry'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../../utils/xlsx'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const entity = getRouterParam(event, 'entity') as string
  const def = getMaster(entity)

  const rows = (await db
    .select()
    .from(def.table)
    .orderBy(asc(def.table[def.sortKey]))) as Record<string, unknown>[]

  // Prefer the real row shape (includes id + system columns for reference);
  // fall back to the create-schema keys when the table is empty.
  const keys = rows.length ? Object.keys(rows[0]!) : masterColumns(def)
  const columns: XlsxColumn[] = keys.map((key) => ({ key }))

  const buf = await buildXlsx(columns, rows, entity)
  return sendXlsx(event, buf, `${entity}-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
