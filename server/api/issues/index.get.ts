// GET /api/issues — Phase H. Admin-only triage list of captured error reports.
// Screenshots (large base64) are stripped from the list payload; a `hasShot`
// flag tells the UI whether the detail view has an image to show.
// Optional ?status=draft filter; newest first.
import { desc } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { Issue, IssueStatus } from '../../../app/types'

export type IssueListRow = Omit<Issue, 'screenshot' | 'stack' | 'detail'> & {
  hasShot: boolean
}

const STATUSES: IssueStatus[] = ['draft', 'open', 'in_progress', 'resolved', 'closed']

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const q = getQuery(event)
  const statusFilter =
    typeof q.status === 'string' && STATUSES.includes(q.status as IssueStatus)
      ? (q.status as IssueStatus)
      : null

  const rows = await db.query.issues.findMany({
    orderBy: [desc(schema.issues.createdAt)],
  })

  const issues: IssueListRow[] = rows
    .filter((r) => (statusFilter ? r.status === statusFilter : true))
    .map((r) => {
      const { screenshot, stack, detail, ...rest } = r
      return { ...(rest as Omit<Issue, 'screenshot' | 'stack' | 'detail'>), hasShot: !!screenshot }
    })

  // Lightweight per-status counts for the filter chips.
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1

  return { issues, counts, total: rows.length }
})
