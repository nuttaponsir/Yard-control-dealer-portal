// GET /api/procurement/suppliers — supplier picker for the PO create form.
// Accessible to admin AND warehouse (the procurement roles), unlike the
// admin-only masters API. Static path wins over the [id] param route in Nitro.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'warehouse'])
  const rows = await db.query.suppliers.findMany()
  return { suppliers: rows.map((s) => ({ id: s.id, code: s.code, name: s.name })) }
})
