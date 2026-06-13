// GET /api/issues/export — Phase K. Admin-only .xlsx of captured error reports.
// Flattened to scalar columns; the large base64 `screenshot` (plus `stack` /
// `detail` blobs) are excluded to keep the file small. Optional ?status filter
// mirrors the list endpoint. Newest first.
import { desc } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { IssueStatus } from '../../../app/types'

const STATUSES: IssueStatus[] = ['draft', 'open', 'in_progress', 'resolved', 'closed']

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const q = getQuery(event)
  const statusFilter =
    typeof q.status === 'string' && STATUSES.includes(q.status as IssueStatus)
      ? (q.status as IssueStatus)
      : null

  const issueRows = await db.query.issues.findMany({
    orderBy: [desc(schema.issues.createdAt)],
  })

  const rows = issueRows
    .filter((r) => (statusFilter ? r.status === statusFilter : true))
    .map((r) => ({
      issueNumber: r.issueNumber,
      title: r.title,
      module: r.module ?? null,
      page: r.page ?? null,
      action: r.action ?? null,
      severity: r.severity,
      source: r.source,
      status: r.status,
      message: r.message,
      userEmail: r.userEmail ?? null,
      createdAt: r.createdAt,
    }))

  const columns: XlsxColumn[] = [
    { key: 'issueNumber' },
    { key: 'title', width: 40 },
    { key: 'module' },
    { key: 'page', width: 30 },
    { key: 'action', width: 24 },
    { key: 'severity' },
    { key: 'source' },
    { key: 'status' },
    { key: 'message', width: 50 },
    { key: 'userEmail' },
    { key: 'createdAt' },
  ]

  const buf = await buildXlsx(columns, rows, 'Issues')
  return sendXlsx(event, buf, `issues-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
