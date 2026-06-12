// POST /api/notifications/[id]/read — Phase E. Mark one of the current user's
// in-app notifications as read. Scoped: a user can only mark their own rows
// (404 otherwise). Idempotent — re-reading an already-read row is fine.
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสการแจ้งเตือนไม่ถูกต้อง' })
  }

  const [updated] = await db
    .update(schema.notifications)
    .set({ readAt: new Date().toISOString(), status: 'read' })
    .where(
      and(
        eq(schema.notifications.id, id),
        eq(schema.notifications.userId, user.id),
        eq(schema.notifications.channel, 'inapp'),
      ),
    )
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบการแจ้งเตือน' })
  }
  return { notification: updated }
})
