// GET /api/users — Phase G (User Management). Admin-only directory of every
// user account, enriched with the dealer name. The password hash is NEVER
// included in the response.
import { requireUser } from '../../utils/auth'
import { db } from '../../db'
import { readPagination, paginate } from '../../utils/pagination'
import type { Role } from '../../../app/types'

export interface UserRow {
  id: number
  email: string
  role: Role
  dealerId: number | null
  dealerName: string | null
  active: boolean
  createdAt: string
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const userRows = await db.query.users.findMany()
  const dealerRows = await db.query.dealers.findMany()
  const dealerName = new Map(dealerRows.map((d) => [d.id, d.name]))

  const users: UserRow[] = userRows
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

  const pagination = readPagination(event)
  if (pagination) {
    const { items, meta } = paginate(users, pagination)
    return { users: items, meta }
  }

  return { users }
})
