// GET /api/issues/:id — Phase H. Admin-only full issue detail, including the
// screenshot data URL, stack and detail JSON.
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid issue id' })
  }

  const issue = await db.query.issues.findFirst({
    where: eq(schema.issues.id, id),
  })
  if (!issue) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบ Issue' })
  }

  return { issue }
})
