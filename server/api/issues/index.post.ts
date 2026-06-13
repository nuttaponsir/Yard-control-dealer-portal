// POST /api/issues — Phase H (Issue tracker / auto error capture).
//
// This is the SINK for the client error-capture plugin. It is deliberately
// PERMISSIVE: it never throws 401/403. An error reporter that itself fails to
// authenticate would be useless — errors frequently happen exactly when a
// session has expired or auth is the thing that broke. We resolve the user
// when we can (to record "who"), but accept anonymous reports too.
//
// New rows always land as status='draft' so a human triages them before they
// become tracked issues. The write is best-effort and must never surface a
// noisy error back to the page that was already broken.
import { z } from 'zod'
import { db, schema } from '../../db'
import { getUser } from '../../utils/auth'

// Screenshots are base64 data URLs and can be large. Cap the stored size so a
// runaway capture can't bloat the row; oversized images are dropped (the rest
// of the report is still saved).
const MAX_SCREENSHOT_CHARS = 3_500_000 // ~2.6 MB decoded

const createIssueSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  module: z.string().trim().max(60).nullable().optional(),
  page: z.string().trim().max(300).nullable().optional(),
  action: z.string().trim().max(300).nullable().optional(),
  severity: z.enum(['error', 'warning', 'info']).optional(),
  source: z.enum(['api', 'unhandled', 'rejection', 'vue', 'manual']),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).nullable().optional(),
  detail: z.string().max(8000).nullable().optional(),
  screenshot: z.string().nullable().optional(),
})

function issueNumber(seq: number): string {
  const year = new Date().getFullYear()
  return `ISSUE-${year}-${String(seq).padStart(6, '0')}`
}

export default defineEventHandler(async (event) => {
  // Resolve the reporter without requiring auth — never throws.
  const user = await getUser(event).catch(() => null)

  const raw = await readBody(event).catch(() => null)
  const parsed = createIssueSchema.safeParse(raw)
  if (!parsed.success) {
    // Bad payload: report it but don't 500. The reporter shouldn't retry-loop.
    throw createError({ statusCode: 400, statusMessage: 'Invalid issue payload' })
  }
  const body = parsed.data

  // Drop oversized screenshots rather than rejecting the whole report.
  const screenshot =
    body.screenshot && body.screenshot.length <= MAX_SCREENSHOT_CHARS
      ? body.screenshot
      : null

  const title = (body.title ?? body.message).slice(0, 200)
  const now = new Date().toISOString()

  try {
    // Unique ISSUE sequence (continue past existing rows).
    const existing = await db.query.issues.findMany({ columns: { issueNumber: true } })
    const maxSeq = existing.reduce((max, r) => {
      const m = /-(\d{6})$/.exec(r.issueNumber)
      return m ? Math.max(max, Number(m[1])) : max
    }, 0)
    const num = issueNumber(maxSeq + 1)

    const [created] = await db
      .insert(schema.issues)
      .values({
        issueNumber: num,
        title,
        module: body.module ?? null,
        page: body.page ?? null,
        action: body.action ?? null,
        severity: body.severity ?? 'error',
        source: body.source,
        message: body.message,
        stack: body.stack ?? null,
        detail: body.detail ?? null,
        screenshot,
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        status: 'draft',
        createdAt: now,
      })
      .returning({ id: schema.issues.id, issueNumber: schema.issues.issueNumber })

    return { ok: true, id: created!.id, issueNumber: created!.issueNumber }
  } catch (err) {
    // Persisting the report failed — log server-side, return a soft error.
    console.error('[issues] failed to save error report', err)
    throw createError({ statusCode: 500, statusMessage: 'Failed to save issue' })
  }
})
