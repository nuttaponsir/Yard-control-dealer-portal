// GET /api/users/export — Phase K. Admin-only .xlsx of the user directory.
// SECURITY: only safe scalar fields are exported. The password hash and any
// secret/token columns are NEVER included.
import { requireUser } from '../../utils/auth'
import { db } from '../../db'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { Role } from '../../../app/types'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const userRows = await db.query.users.findMany()
  const dealerRows = await db.query.dealers.findMany()
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  const rows = userRows
    .map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role as Role,
      dealerId: u.dealerId ?? null,
      dealerName: u.dealerId != null ? (dealerName.get(u.dealerId) ?? null) : null,
      active: u.active,
      createdAt: u.createdAt,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))

  const columns: XlsxColumn[] = [
    { key: 'id' },
    { key: 'email' },
    { key: 'role' },
    { key: 'dealerId' },
    { key: 'dealerName' },
    { key: 'active' },
    { key: 'createdAt' },
  ]

  const buf = await buildXlsx(columns, rows, 'Users')
  return sendXlsx(event, buf, `users-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
