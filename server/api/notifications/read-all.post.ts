// POST /api/notifications/read-all — Phase E. Mark all of the current user's
// unread in-app notifications as read. Returns how many were updated.
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const updated = await db
    .update(schema.notifications)
    .set({ readAt: new Date().toISOString(), status: 'read' })
    .where(
      and(
        eq(schema.notifications.userId, user.id),
        eq(schema.notifications.channel, 'inapp'),
        isNull(schema.notifications.readAt),
      ),
    )
    .returning({ id: schema.notifications.id })

  return { updated: updated.length }
})
