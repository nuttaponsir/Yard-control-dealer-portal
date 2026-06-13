// PATCH /api/issues/:id — Phase H. Admin-only triage: move an issue through its
// status lifecycle (draft → open → in_progress → resolved → closed) and/or
// tweak its title/severity. Records updatedAt and an audit row.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'

const patchSchema = z
  .object({
    status: z.enum(['draft', 'open', 'in_progress', 'resolved', 'closed']).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    severity: z.enum(['error', 'warning', 'info']).optional(),
  })
  .refine((b) => b.status || b.title || b.severity, {
    message: 'No fields to update',
  })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid issue id' })
  }

  const body = await parseBody(event, patchSchema)

  const current = await db.query.issues.findFirst({ where: eq(schema.issues.id, id) })
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบ Issue' })
  }

  const [updated] = await db
    .update(schema.issues)
    .set({
      ...(body.status ? { status: body.status } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.severity ? { severity: body.severity } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.issues.id, id))
    .returning()

  if (body.status && body.status !== current.status) {
    await writeAudit(
      user.id,
      'issue.status',
      'issue',
      current.issueNumber,
      `${current.status} → ${body.status}`,
    )
  }

  return { ok: true, issue: updated }
})
