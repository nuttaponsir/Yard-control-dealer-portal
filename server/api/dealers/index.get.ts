// GET /api/dealers — Dev4 owns. Dealer directory + grade summary (admin only).
// Optional ?q= filters by code / name / province (case-insensitive substring).
import { requireUser } from '../../utils/auth'
import { db } from '../../db'
import { readPagination, paginate } from '../../utils/pagination'
import type { Dealer, Grade } from '../../../app/types'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const q = (getQuery(event).q as string | undefined)?.trim().toLowerCase() ?? ''

  const all = await db.query.dealers.findMany()
  const dealers = all
    .map((d): Dealer => ({
      id: d.id,
      code: d.code,
      name: d.name,
      province: d.province,
      phone: d.phone,
      grade: d.grade as Grade,
      creditLimit: d.creditLimit,
      creditUsed: d.creditUsed,
      createdAt: d.createdAt,
    }))
    .sort((a, b) => a.code.localeCompare(b.code))

  const filtered = q
    ? dealers.filter(
        (d) =>
          d.code.toLowerCase().includes(q) ||
          d.name.toLowerCase().includes(q) ||
          d.province.toLowerCase().includes(q),
      )
    : dealers

  // Grade counts come from the FULL set (KPIs are network-wide, not filtered).
  const summary = {
    total: dealers.length,
    gradeA: dealers.filter((d) => d.grade === 'A').length,
    gradeB: dealers.filter((d) => d.grade === 'B').length,
    gradeC: dealers.filter((d) => d.grade === 'C').length,
  }

  // Opt-in pagination over the (q-)filtered list; summary stays network-wide.
  const pagination = readPagination(event)
  if (pagination) {
    const { items, meta } = paginate(filtered, pagination)
    return { dealers: items, summary, meta }
  }

  return { dealers: filtered, summary }
})
